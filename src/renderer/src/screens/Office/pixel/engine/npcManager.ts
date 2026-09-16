/**
 * 996 NPC Manager — handles non-agent characters:
 * - 6 CodePet "coworkers" (palette 0-5): always present, simulate working
 *   When a real agent connects, it takes over one coworker's seat
 * - 996 bubble: shows on all characters after 21:00
 */

import { findPath } from '../layout/tileMap';
import type { Character, Seat, TileType as TileTypeVal } from '../types';
import { CharacterState, Direction, TILE_SIZE } from '../types';
import { createCharacter } from './characters';
import { matrixEffectSeeds } from './matrixEffect';
import {
  pickBreakStatus,
  pickCollabStatus,
  pickStatusOrMumble,
  pickWorkStatus,
  STATUS_DURATION_MAX,
  STATUS_DURATION_MIN,
} from './workStatus';

const COWORKER_BASE_ID = -100; // -100, -101, -102, -103, -104, -105
const COWORKER_COUNT = 6;

// Coworker work/break cycle
const COWORKER_WORK_MIN_SEC = 6;
const COWORKER_WORK_MAX_SEC = 18;
const COWORKER_BREAK_MIN_SEC = 5;
const COWORKER_BREAK_MAX_SEC = 12;

// Busy-mode work activity cycle (shorter intervals for visual variety)
const BUSY_WORK_MIN_SEC = 4;
const BUSY_WORK_MAX_SEC = 10;
const BUSY_ERRAND_MIN_SEC = 6;
const BUSY_ERRAND_MAX_SEC = 12;

// 996
const OVERTIME_CHECK_INTERVAL_SEC = 60;

/** Whether team mode (NPC coworkers) is enabled. Default: true. */
let teamModeEnabled = true;

interface NpcState {
  coworkersSpawned: boolean;
  overtimeCheckTimer: number;
  overtimeActive: boolean;
  coworkerTimers: number[];
  takenOverIds: Set<number>;
  /** True when any real agent is actively working — NPC break activities are suppressed */
  agentBusy: boolean;
  /** Cached references for pathfinding (set each update frame) */
  tileMap: TileTypeVal[][] | null;
  blockedTiles: Set<string> | null;
  seats: Map<string, Seat> | null;
}

const state: NpcState = {
  coworkersSpawned: false,
  overtimeCheckTimer: 10,
  overtimeActive: false,
  coworkerTimers: [],
  takenOverIds: new Set(),
  agentBusy: false,
  tileMap: null,
  blockedTiles: null,
  seats: null,
};

// ─── Coworkers ───────────────────────────────────────────

function spawnCoworkers(
  characters: Map<number, Character>,
  seats: Map<string, Seat>,
  walkableTiles: Array<{ col: number; row: number }>,
): void {
  if (state.coworkersSpawned) return;
  if (walkableTiles.length === 0) return;

  const freeSeats: string[] = [];
  for (const [seatId, seat] of seats) {
    if (!seat.assigned) freeSeats.push(seatId);
  }

  for (let i = 0; i < COWORKER_COUNT; i++) {
    const id = COWORKER_BASE_ID - i;
    const palette = i;

    let ch: Character;
    if (freeSeats.length > 0) {
      const seatId = freeSeats.shift()!;
      const seat = seats.get(seatId)!;
      seat.assigned = true;
      ch = createCharacter(id, palette, seatId, seat, 0);
      ch.isActive = true;
      ch.state = CharacterState.TYPE;
    } else {
      const spawn = walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
      ch = createCharacter(id, palette, null, null, 0);
      ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
      ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
      ch.tileCol = spawn.col;
      ch.tileRow = spawn.row;
      ch.isActive = false;
      ch.state = CharacterState.IDLE;
    }

    const tools = ['Read', 'Write', 'Edit', 'Bash', 'Grep', null];
    ch.currentTool = tools[Math.floor(Math.random() * tools.length)];
    ch.matrixEffect = 'spawn';
    ch.matrixEffectTimer = 0;
    ch.matrixEffectSeeds = matrixEffectSeeds();

    characters.set(id, ch);
    state.coworkerTimers.push(randomRange(COWORKER_WORK_MIN_SEC, COWORKER_WORK_MAX_SEC));
  }

  state.coworkersSpawned = true;
}

// ─── Break Activities (office life simulation) ──────────

type BreakActivity =
  | 'wander' // 随便走走
  | 'water' // 去饮水机接水
  | 'tea' // 去茶水间喝茶
  | 'meeting' // 去会议室
  | 'chat' // 找同事聊天（走向另一个人）
  | 'rest' // 去折叠床/沙发休息
  | 'goOut' // 出门（走到门口消失一会再回来）
  | 'stretch'; // 在工位旁伸懒腰（短暂站立）

const BREAK_ACTIVITIES: { activity: BreakActivity; weight: number }[] = [
  { activity: 'wander', weight: 2 },
  { activity: 'water', weight: 2 },
  { activity: 'tea', weight: 2 },
  { activity: 'meeting', weight: 1 },
  { activity: 'chat', weight: 3 },
  { activity: 'rest', weight: 1 },
  { activity: 'goOut', weight: 1 },
  { activity: 'stretch', weight: 2 },
];

function pickBreakActivity(): BreakActivity {
  const totalWeight = BREAK_ACTIVITIES.reduce((s, a) => s + a.weight, 0);
  let r = Math.random() * totalWeight;
  for (const a of BREAK_ACTIVITIES) {
    r -= a.weight;
    if (r <= 0) return a.activity;
  }
  return 'wander';
}

/** Points of interest in the office layout */
const POI = {
  waterDispenser: { col: 21, row: 2 },
  teaTable: { col: 18, row: 8 },
  meetingRoom: { col: 3, row: 4 },
  sofa: { col: 18, row: 3 },
  foldingBed: { col: 20, row: 5 },
  door: { col: 11, row: 15 },
  whiteboard: { col: 7, row: 2 },
};

// ─── Busy Work Activities (during agent execution) ─────

type WorkActivity =
  | 'coding' // 坐工位写代码（换工具）
  | 'whiteboard' // 去白板讨论方案
  | 'pairWork' // 走到同事桌前结对
  | 'quickMeeting' // 快速碰头会议室
  | 'water' // 接杯水回来继续
  | 'stretch'; // 站起来伸个腰

const WORK_ACTIVITIES: { activity: WorkActivity; weight: number }[] = [
  { activity: 'coding', weight: 4 },
  { activity: 'whiteboard', weight: 2 },
  { activity: 'pairWork', weight: 3 },
  { activity: 'quickMeeting', weight: 1 },
  { activity: 'water', weight: 1 },
  { activity: 'stretch', weight: 2 },
];

function pickWorkActivity(): WorkActivity {
  const totalWeight = WORK_ACTIVITIES.reduce((s, a) => s + a.weight, 0);
  let r = Math.random() * totalWeight;
  for (const a of WORK_ACTIVITIES) {
    r -= a.weight;
    if (r <= 0) return a.activity;
  }
  return 'coding';
}

/**
 * Try to pathfind character to a target POI tile.
 * Returns true if a path was found and assigned.
 */
function sendToPoi(
  ch: Character,
  target: { col: number; row: number },
  facingDir: Direction,
): boolean {
  if (!state.tileMap || !state.blockedTiles) return false;
  const path = findPath(
    ch.tileCol,
    ch.tileRow,
    target.col,
    target.row,
    state.tileMap,
    state.blockedTiles,
  );
  if (path.length === 0) return false;
  ch.path = path;
  ch.pathIndex = 0;
  ch.moveProgress = 0;
  ch.state = CharacterState.WALK;
  ch.frame = 0;
  ch.frameTimer = 0;
  ch.arrivalDir = facingDir;
  return true;
}

/** Send character back to their seat via pathfinding */
function sendToSeat(ch: Character): boolean {
  if (!ch.seatId || !state.seats || !state.tileMap || !state.blockedTiles) return false;
  const seat = state.seats.get(ch.seatId);
  if (!seat) return false;
  if (ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
    // Already at seat — just sit down
    ch.state = CharacterState.TYPE;
    ch.dir = seat.facingDir;
    ch.frame = 0;
    ch.frameTimer = 0;
    return true;
  }
  const path = findPath(
    ch.tileCol,
    ch.tileRow,
    seat.seatCol,
    seat.seatRow,
    state.tileMap,
    state.blockedTiles,
  );
  if (path.length === 0) return false;
  ch.path = path;
  ch.pathIndex = 0;
  ch.moveProgress = 0;
  ch.state = CharacterState.WALK;
  ch.frame = 0;
  ch.frameTimer = 0;
  ch.isActive = true; // will sit down when arriving at seat
  return true;
}

/** Find a random colleague's seat position (for pair-work) */
function findColleagueSeat(myId: number): { col: number; row: number; dir: Direction } | null {
  if (!state.seats) return null;
  const candidates: Array<{ col: number; row: number; dir: Direction }> = [];
  for (let i = 0; i < COWORKER_COUNT; i++) {
    const id = COWORKER_BASE_ID - i;
    if (id === myId || state.takenOverIds.has(id)) continue;
    // Find their seat
    for (const [, seat] of state.seats) {
      if (seat.assigned) {
        // Use position adjacent to the seat (1 tile away from facing direction)
        candidates.push({
          col: seat.seatCol,
          row: seat.seatRow + 1, // stand behind them
          dir: Direction.UP,
        });
        break;
      }
    }
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * Apply a work activity to a coworker during busy mode.
 * Uses real pathfinding to walk to POI targets.
 * Returns the timer duration for this activity phase.
 */
/** Set a work status message on a character with a random duration */
function setStatus(ch: Character, status: string): void {
  ch.workStatus = status;
  ch.workStatusTimer = randomRange(STATUS_DURATION_MIN, STATUS_DURATION_MAX);
}

function applyWorkActivity(ch: Character, activity: WorkActivity): number {
  const tools = ['Write', 'Read', 'Edit', 'Grep', 'Bash', 'WebFetch'];

  switch (activity) {
    case 'coding': {
      // Go back to desk and code (switch tool for visual variety)
      const tool = tools[Math.floor(Math.random() * tools.length)];
      if (ch.state !== CharacterState.TYPE) {
        sendToSeat(ch);
      } else {
        ch.isActive = true;
      }
      ch.currentTool = tool;
      setStatus(ch, pickWorkStatus(tool));
      return randomRange(BUSY_WORK_MIN_SEC, BUSY_WORK_MAX_SEC);
    }

    case 'whiteboard': {
      // Walk to whiteboard, face it
      ch.isActive = false;
      ch.seatTimer = 0;
      const sent = sendToPoi(ch, POI.whiteboard, Direction.UP);
      if (!sent) {
        ch.isActive = true;
        ch.currentTool = tools[Math.floor(Math.random() * tools.length)];
      }
      setStatus(ch, pickCollabStatus());
      return randomRange(BUSY_ERRAND_MIN_SEC, BUSY_ERRAND_MAX_SEC);
    }

    case 'pairWork': {
      // Walk to a colleague's desk area
      ch.isActive = false;
      ch.seatTimer = 0;
      const colleague = findColleagueSeat(ch.id);
      if (colleague) {
        sendToPoi(ch, { col: colleague.col, row: colleague.row }, colleague.dir);
      }
      setStatus(ch, pickCollabStatus());
      return randomRange(BUSY_ERRAND_MIN_SEC, BUSY_ERRAND_MAX_SEC);
    }

    case 'quickMeeting': {
      // Walk to meeting room
      ch.isActive = false;
      ch.seatTimer = 0;
      sendToPoi(ch, POI.meetingRoom, Direction.UP);
      setStatus(ch, pickCollabStatus());
      return randomRange(BUSY_ERRAND_MIN_SEC, BUSY_ERRAND_MAX_SEC + 5);
    }

    case 'water': {
      // Quick water break
      ch.isActive = false;
      ch.seatTimer = 0;
      sendToPoi(ch, POI.waterDispenser, Direction.UP);
      setStatus(ch, pickBreakStatus());
      return randomRange(BUSY_ERRAND_MIN_SEC, BUSY_ERRAND_MAX_SEC);
    }

    case 'stretch':
      // Stand up briefly near desk
      ch.isActive = false;
      ch.seatTimer = 0;
      ch.wanderLimit = 2;
      ch.wanderTimer = 0.3;
      setStatus(ch, pickBreakStatus());
      return randomRange(3, 6);
  }
}

/** Track coworkers who are "out of office" — they'll come back after a while */
const outOfOffice: Map<number, number> = new Map(); // id -> return timer

function updateCoworkers(dt: number, characters: Map<number, Character>): void {
  // Handle "out of office" coworkers returning
  for (const [id, timer] of outOfOffice) {
    const remaining = timer - dt;
    if (remaining <= 0) {
      outOfOffice.delete(id);
      // Respawn at door
      const ch = characters.get(id);
      if (ch) {
        ch.x = POI.door.col * TILE_SIZE + TILE_SIZE / 2;
        ch.y = POI.door.row * TILE_SIZE + TILE_SIZE / 2;
        ch.tileCol = POI.door.col;
        ch.tileRow = POI.door.row;
        ch.isActive = true; // go back to work
        ch.state = CharacterState.IDLE;
        ch.wanderTimer = 0;
      }
    } else {
      outOfOffice.set(id, remaining);
    }
  }

  for (let i = 0; i < COWORKER_COUNT; i++) {
    const id = COWORKER_BASE_ID - i;
    if (state.takenOverIds.has(id)) continue;
    if (outOfOffice.has(id)) continue; // currently outside

    const ch = characters.get(id);
    if (!ch) continue;
    if (ch.matrixEffect) continue;
    if (i >= state.coworkerTimers.length) continue;

    state.coworkerTimers[i] -= dt;

    // Update work status timer — refresh message when expired
    if (ch.workStatusTimer != null && ch.workStatusTimer > 0) {
      ch.workStatusTimer -= dt;
      if (ch.workStatusTimer <= 0) {
        if (state.agentBusy && ch.isActive) {
          setStatus(ch, pickStatusOrMumble(ch.currentTool, ch.palette));
        } else {
          // Not busy or not active — clear status
          ch.workStatus = null;
        }
      }
    }

    if (state.coworkerTimers[i] <= 0) {
      if (state.agentBusy) {
        // Agent is working — if NPC is away from desk, send them back first
        if (!ch.isActive && ch.state !== CharacterState.WALK) {
          sendToSeat(ch);
          state.coworkerTimers[i] = randomRange(BUSY_WORK_MIN_SEC, BUSY_WORK_MAX_SEC);
          continue;
        }
        // Pick a WORK activity (coding, whiteboard, pair, etc.)
        const activity = pickWorkActivity();
        state.coworkerTimers[i] = applyWorkActivity(ch, activity);
        continue;
      }

      if (ch.isActive) {
        // Agent idle → done working, pick a break activity
        ch.isActive = false;
        ch.seatTimer = 0;

        const activity = pickBreakActivity();

        switch (activity) {
          case 'water':
            // Walk to water dispenser
            ch.wanderLimit = 20;
            ch.wanderTimer = 0;
            state.coworkerTimers[i] = randomRange(12, 20);
            break;

          case 'tea':
            // Walk to tea table
            ch.wanderLimit = 20;
            ch.wanderTimer = 0;
            state.coworkerTimers[i] = randomRange(15, 25);
            break;

          case 'meeting':
            // Walk to meeting room
            ch.wanderLimit = 25;
            ch.wanderTimer = 0;
            state.coworkerTimers[i] = randomRange(20, 40);
            break;

          case 'chat':
            // Find another coworker and walk toward them
            ch.wanderLimit = 8;
            ch.wanderTimer = 0;
            state.coworkerTimers[i] = randomRange(8, 15);
            break;

          case 'rest':
            // Walk to sofa/folding bed
            ch.wanderLimit = 25;
            ch.wanderTimer = 0;
            state.coworkerTimers[i] = randomRange(20, 35);
            break;

          case 'goOut':
            // Walk to door, then "disappear" for a while
            ch.wanderLimit = 30;
            ch.wanderTimer = 0;
            state.coworkerTimers[i] = randomRange(25, 40);
            break;

          case 'stretch':
            // Just stand up briefly near desk
            ch.wanderLimit = 2;
            ch.wanderTimer = 0.5;
            state.coworkerTimers[i] = randomRange(4, 8);
            break;

          default:
            // wander
            ch.wanderLimit = randomRange(3, 8);
            ch.wanderTimer = 0;
            state.coworkerTimers[i] = randomRange(COWORKER_BREAK_MIN_SEC, COWORKER_BREAK_MAX_SEC);
        }
      } else {
        // Check if near the door — might be "going out"
        if (
          Math.abs(ch.tileCol - POI.door.col) <= 2 &&
          Math.abs(ch.tileRow - POI.door.row) <= 2 &&
          ch.wanderLimit >= 25
        ) {
          // Arrived at door — go "outside" (hide character for a while)
          ch.x = -100; // move off screen
          ch.y = -100;
          ch.state = CharacterState.IDLE;
          ch.path = [];
          ch.pathIndex = 0;
          outOfOffice.set(id, randomRange(15, 30)); // come back in 15-30s
          state.coworkerTimers[i] = 999; // don't trigger again while out
          continue;
        }

        // Break over → back to work
        ch.isActive = true;
        const tools = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'WebFetch', null];
        ch.currentTool = tools[Math.floor(Math.random() * tools.length)];
        state.coworkerTimers[i] = randomRange(COWORKER_WORK_MIN_SEC, COWORKER_WORK_MAX_SEC);
      }
    }
  }
}

export function takeOverCoworker(
  characters: Map<number, Character>,
): { seatId: string | null; palette: number; hueShift: number } | null {
  for (let i = 0; i < COWORKER_COUNT; i++) {
    const id = COWORKER_BASE_ID - i;
    if (state.takenOverIds.has(id)) continue;
    const ch = characters.get(id);
    if (!ch) continue;

    state.takenOverIds.add(id);
    const seatId = ch.seatId;
    const palette = ch.palette;

    ch.matrixEffect = 'despawn';
    ch.matrixEffectTimer = 0;
    ch.matrixEffectSeeds = matrixEffectSeeds();

    return { seatId, palette, hueShift: 0 };
  }
  return null;
}

// ─── 996 Overtime ────────────────────────────────────────

function isOvertimeHour(): boolean {
  const hour = new Date().getHours();
  return hour >= 21 || hour < 6;
}

function updateOvertimeBubbles(characters: Map<number, Character>): void {
  const overtime = isOvertimeHour();
  if (overtime && !state.overtimeActive) {
    for (const ch of characters.values()) {
      if (!ch.bubbleType) {
        ch.bubbleType = 'waiting';
        ch.bubbleTimer = 5;
      }
    }
    state.overtimeActive = true;
  } else if (!overtime && state.overtimeActive) {
    state.overtimeActive = false;
  }
}

// ─── Team Sync ───────────────────────────────────────────

/** Recall a coworker who is currently "out of office" — respawn at door, set active */
function recallFromOutside(ch: Character, id: number): void {
  if (!outOfOffice.has(id)) return;
  outOfOffice.delete(id);
  ch.x = POI.door.col * TILE_SIZE + TILE_SIZE / 2;
  ch.y = POI.door.row * TILE_SIZE + TILE_SIZE / 2;
  ch.tileCol = POI.door.col;
  ch.tileRow = POI.door.row;
  ch.state = CharacterState.IDLE;
  ch.wanderTimer = 0;
}

/** Map agent tool to NPC team reaction */
function getTeamReaction(toolName: string): {
  /** Tool NPCs at desk should show */
  npcTools: Array<string | null>;
  /** Whether some NPCs should get up (whiteboard/meeting) */
  triggerErrand: boolean;
  /** Specific errand type if triggered */
  errandType: WorkActivity | null;
} {
  switch (toolName) {
    case 'Read':
    case 'Grep':
    case 'Glob':
    case 'WebFetch':
    case 'WebSearch':
      // Agent reviewing code — team reads/reviews together
      return {
        npcTools: ['Read', 'Grep', 'Read', 'WebFetch'],
        triggerErrand: false,
        errandType: null,
      };
    case 'Write':
    case 'Edit':
      // Agent writing code — team writes in parallel, someone checks whiteboard
      return {
        npcTools: ['Write', 'Edit', 'Write', 'Read'],
        triggerErrand: true,
        errandType: 'whiteboard',
      };
    case 'Bash':
      // Agent running command — some watch nervously, some keep coding
      return { npcTools: ['Bash', 'Read', 'Grep', null], triggerErrand: false, errandType: null };
    case 'Task':
    case 'Agent':
      // Sub-task/agent — meeting mode, pair work
      return {
        npcTools: ['Write', 'Read', 'Edit', 'Grep'],
        triggerErrand: true,
        errandType: 'quickMeeting',
      };
    default:
      return {
        npcTools: ['Write', 'Read', 'Edit', 'Grep', 'Bash'],
        triggerErrand: false,
        errandType: null,
      };
  }
}

/**
 * Agent started working — activate ALL coworkers immediately.
 * Everyone goes to desk and works. Tool-switch timers are staggered
 * so NPCs change activities at different times (relay rhythm).
 * One NPC may go on an errand (whiteboard/meeting) if applicable.
 */
export function syncTeamToAgentTool(
  toolName: string | null,
  characters: Map<number, Character>,
): void {
  if (!toolName) return;

  state.agentBusy = true;
  const reaction = getTeamReaction(toolName);
  let errandAssigned = false;
  let count = 0;

  for (let i = 0; i < COWORKER_COUNT; i++) {
    const id = COWORKER_BASE_ID - i;
    if (state.takenOverIds.has(id)) continue;
    const ch = characters.get(id);
    if (!ch || ch.matrixEffect) continue;

    // Recall anyone who's out of office
    recallFromOutside(ch, id);

    // One NPC on errand (whiteboard/meeting) — the rest go to desk
    if (reaction.triggerErrand && !errandAssigned && reaction.errandType && count >= 2) {
      ch.isActive = false;
      ch.seatTimer = 0;
      ch.path = [];
      ch.pathIndex = 0;
      if (reaction.errandType === 'whiteboard') {
        sendToPoi(ch, POI.whiteboard, Direction.UP);
      } else if (reaction.errandType === 'quickMeeting') {
        sendToPoi(ch, POI.meetingRoom, Direction.UP);
      }
      setStatus(ch, pickCollabStatus());
      errandAssigned = true;
      if (i < state.coworkerTimers.length) {
        state.coworkerTimers[i] = randomRange(BUSY_ERRAND_MIN_SEC, BUSY_ERRAND_MAX_SEC);
      }
      count++;
      continue;
    }

    // Activate immediately — go to desk and work
    ch.isActive = true;
    ch.path = [];
    ch.pathIndex = 0;
    const npcTool = reaction.npcTools[Math.floor(Math.random() * reaction.npcTools.length)];
    ch.currentTool = npcTool;
    setStatus(ch, pickStatusOrMumble(npcTool, ch.palette));

    // Stagger tool-switch timers for relay rhythm (not activation delay)
    if (i < state.coworkerTimers.length) {
      state.coworkerTimers[i] = randomRange(
        BUSY_WORK_MIN_SEC + count * 2,
        BUSY_WORK_MAX_SEC + count * 2,
      );
    }
    count++;
  }
}

/**
 * Agent went idle — gradually let coworkers take breaks.
 * Not everyone at once: stagger via randomized timers so it looks natural.
 */
export function syncTeamToAgentIdle(characters: Map<number, Character>): void {
  state.agentBusy = false;
  for (let i = 0; i < COWORKER_COUNT; i++) {
    const id0 = COWORKER_BASE_ID - i;
    if (!state.takenOverIds.has(id0)) {
      const ch0 = characters.get(id0);
      if (ch0) ch0.workStatus = null; // Clear status when going idle
    }
  }
  for (let i = 0; i < COWORKER_COUNT; i++) {
    const id = COWORKER_BASE_ID - i;
    if (state.takenOverIds.has(id)) continue;
    const ch = characters.get(id);
    if (!ch || ch.matrixEffect) continue;

    // Stagger: each coworker gets a random delay before they "finish up"
    // Some stay at desk longer, some take a break sooner
    if (i < state.coworkerTimers.length) {
      state.coworkerTimers[i] = randomRange(3 + i * 2, 8 + i * 3);
    }
  }
}

// ─── Main Update ─────────────────────────────────────────

export function updateNpcs(
  dt: number,
  characters: Map<number, Character>,
  walkableTiles: Array<{ col: number; row: number }>,
  seats: Map<string, Seat>,
  tileMap?: TileTypeVal[][],
  blockedTiles?: Set<string>,
): void {
  // Cache references for pathfinding in work activities
  if (tileMap) state.tileMap = tileMap;
  if (blockedTiles) state.blockedTiles = blockedTiles;
  state.seats = seats;

  if (teamModeEnabled) {
    if (!state.coworkersSpawned) {
      spawnCoworkers(characters, seats, walkableTiles);
    }
    updateCoworkers(dt, characters);
  }

  // 996
  state.overtimeCheckTimer -= dt;
  if (state.overtimeCheckTimer <= 0) {
    updateOvertimeBubbles(characters);
    state.overtimeCheckTimer = OVERTIME_CHECK_INTERVAL_SEC;
  }
}

// ─── Utilities ───────────────────────────────────────────

export function isNpcId(id: number): boolean {
  return id <= COWORKER_BASE_ID && id > COWORKER_BASE_ID - COWORKER_COUNT;
}

export function getNpcName(id: number): string | null {
  if (id <= COWORKER_BASE_ID && id > COWORKER_BASE_ID - COWORKER_COUNT) return '👤';
  return null;
}

export function getTeamMode(): boolean {
  return teamModeEnabled;
}

export function setTeamMode(
  enabled: boolean,
  characters: Map<number, Character>,
  seats: Map<string, Seat>,
): void {
  if (teamModeEnabled === enabled) return;
  teamModeEnabled = enabled;

  if (!enabled) {
    for (let i = 0; i < COWORKER_COUNT; i++) {
      const id = COWORKER_BASE_ID - i;
      if (state.takenOverIds.has(id)) continue;
      const ch = characters.get(id);
      if (!ch) continue;
      if (ch.matrixEffect === 'despawn') continue;
      if (ch.seatId) {
        const seat = seats.get(ch.seatId);
        if (seat) seat.assigned = false;
      }
      ch.matrixEffect = 'despawn';
      ch.matrixEffectTimer = 0;
      ch.matrixEffectSeeds = matrixEffectSeeds();
    }
  } else {
    state.coworkersSpawned = false;
    state.coworkerTimers = [];
  }
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
