#[cfg(windows)]
mod platform {
    use std::io;
    use std::mem::{size_of, zeroed};
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle};
    use std::process::Child;
    use std::ptr::null;

    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    fn last_error(context: &str) -> String {
        format!("{context}：{}", io::Error::last_os_error())
    }

    /// Windows Job Object 句柄。
    ///
    /// OwnedHandle 自带 Send + Sync，并在 Drop 时关闭句柄；关闭最后一个
    /// 带 KILL_ON_JOB_CLOSE 的 Job 句柄时，内核会清掉整棵子进程树。
    pub struct JobHandle {
        handle: OwnedHandle,
    }

    impl JobHandle {
        pub fn create() -> Result<Self, String> {
            let raw = unsafe { CreateJobObjectW(null(), null()) };
            if raw.is_null() {
                return Err(last_error("CreateJobObjectW 失败"));
            }

            let handle = unsafe { OwnedHandle::from_raw_handle(raw as RawHandle) };
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

            let configured = unsafe {
                SetInformationJobObject(
                    handle.as_raw_handle() as HANDLE,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const core::ffi::c_void,
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            };

            if configured == 0 {
                return Err(last_error("SetInformationJobObject 失败"));
            }

            Ok(Self { handle })
        }

        pub fn assign(&self, child: &Child) -> Result<(), String> {
            let raw_process = unsafe {
                OpenProcess(
                    PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_INFORMATION,
                    0,
                    child.id(),
                )
            };

            if raw_process.is_null() {
                return Err(last_error("OpenProcess 失败"));
            }

            let process = unsafe { OwnedHandle::from_raw_handle(raw_process as RawHandle) };
            let assigned = unsafe {
                AssignProcessToJobObject(
                    self.handle.as_raw_handle() as HANDLE,
                    process.as_raw_handle() as HANDLE,
                )
            };

            if assigned == 0 {
                return Err(last_error("AssignProcessToJobObject 失败"));
            }

            Ok(())
        }

        pub fn terminate(&self) -> Result<(), String> {
            let terminated =
                unsafe { TerminateJobObject(self.handle.as_raw_handle() as HANDLE, 1) };

            if terminated == 0 {
                return Err(last_error("TerminateJobObject 失败"));
            }

            Ok(())
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use std::process::Child;

    pub struct JobHandle;

    impl JobHandle {
        pub fn create() -> Result<Self, String> {
            Err("当前平台不支持 Windows Job Object".to_string())
        }

        pub fn assign(&self, _child: &Child) -> Result<(), String> {
            Err("当前平台不支持 Windows Job Object".to_string())
        }

        pub fn terminate(&self) -> Result<(), String> {
            Ok(())
        }
    }
}

pub use platform::JobHandle;
