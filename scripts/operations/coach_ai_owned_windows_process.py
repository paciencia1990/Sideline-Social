"""Future reviewed Windows child ownership; importing performs no native call.

This is not a launcher or an execution approval. A guardian must explicitly call
ensure_owner_outside_job() before launching its sealed collector. A collector
inside that guardian's SILENT_BREAKAWAY_OK job may use OwnedWindowsProcess for
its one logcat client. Every newly created child is checked while suspended,
assigned to its own private job, identified privately, then resumed once.

The injected API contract is intentionally small: current_process/current_pid,
is_in_job, create_job, create_stdio, create_suspended, assign, creation_filetime,
resume, poll, wait, terminate and close_handle. Tests can supply a fictional API;
the default Windows adapter is constructed lazily. No native query occurs here.
"""
import math
import os
from pathlib import PureWindowsPath
import subprocess
import sys


JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK = 0x1000
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
JOB_LIMIT_FLAGS = (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                   | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK)
CREATE_SUSPENDED = 0x00000004
CREATE_NO_WINDOW = 0x08000000
PROCESS_FLAGS = CREATE_SUSPENDED | CREATE_NO_WINDOW


def _native(api):
    return api if api is not None else WindowsProcessApi()


def ensure_owner_outside_job(*, api=None):
    """Guardian-only guard. Never attempts breakaway or a fallback launch."""
    native = _native(api)
    if native.is_in_job(native.current_process()):
        raise RuntimeError('guardian_requires_owner_outside_job')
    return True


def current_process_identity(*, api=None):
    """Private receipt fields only; no command line, environment or device ID."""
    native = _native(api)
    return dict(pid=native.current_pid(),
                creationFileTime=native.creation_filetime(native.current_process()),
                executable=sys.executable)


def _arguments(args, cwd):
    if (not isinstance(args, (list, tuple)) or not args
            or any(not isinstance(value, str) or not value or '\x00' in value
                   for value in args)
            or not PureWindowsPath(args[0]).is_absolute()
            or cwd is not None and (not isinstance(cwd, str)
                                    or '\x00' in cwd
                                    or not PureWindowsPath(cwd).is_absolute())):
        raise ValueError('absolute_executable_and_literal_arguments_required')
    return tuple(args)


class OwnedWindowsProcess:
    """Popen-like ownership of ONE child, with no shell, fallback or restart.

    identity_callback receives only PID, creation FILETIME and executable. It must
    persist that private identity before returning. A raised callback leaves the
    child suspended and triggers bounded cleanup instead of a second attempt.
    stdout/stderr are binary readable file objects only when pipes=True.
    close_owner closes the private job then the process handle; callers close
    readable streams after their pumps stop. The job handle is never inherited.
    """

    def __init__(self, args, *, pipes=False, cwd=None, identity_callback, api=None):
        args = _arguments(args, cwd)
        if type(pipes) is not bool or not callable(identity_callback):
            raise ValueError('explicit_pipe_mode_and_private_identity_callback_required')
        self._api = _native(api)
        self._process = self._thread = self._job = None
        self._stdio = None
        self._closed = False
        self.pid = None
        self.returncode = None
        self.stdout = self.stderr = None
        self.creation_filetime = None
        try:
            self._job = self._api.create_job()
            self._stdio = self._api.create_stdio(pipes)
            self.stdout, self.stderr = self._stdio['stdout'], self._stdio['stderr']
            self._process, self._thread, self.pid = self._api.create_suspended(
                args, cwd, self._stdio['handles'])
            # The guardian's SILENT_BREAKAWAY_OK flag permits this without any
            # CREATE_BREAKAWAY_FROM_JOB escape flag. Refuse an unexpected job.
            if self._api.is_in_job(self._process):
                raise RuntimeError('new_suspended_child_must_be_outside_jobs')
            self._api.assign(self._job, self._process)
            self.creation_filetime = self._api.creation_filetime(self._process)
            self._close_child_stdio()
            identity_callback(dict(pid=self.pid, creationFileTime=self.creation_filetime,
                                   executable=args[0]))
            previous_count = self._api.resume(self._thread)
            if previous_count != 1:
                raise RuntimeError('exactly_one_suspended_thread_required')
            self._close_owned_handle('_thread')
        except Exception:
            self._failed_start_cleanup()
            raise RuntimeError('owned_process_start_failed_no_retry') from None

    def _close_owned_handle(self, name):
        handle = getattr(self, name)
        setattr(self, name, None)
        if handle is not None:
            self._api.close_handle(handle)

    def _close_child_stdio(self):
        if self._stdio is None:
            return
        handles = self._stdio['child_handles']
        self._stdio['child_handles'] = []
        error = None
        for handle in dict.fromkeys(handles):
            try:
                self._api.close_handle(handle)
            except Exception:
                error = True
        if error:
            raise RuntimeError('child_stdio_close_failed')

    def _failed_start_cleanup(self):
        # The original handle is retained throughout. Never rediscover by PID or
        # terminate a process selected by name. No second creation/resume occurs.
        if self._process is not None:
            try:
                if self._api.poll(self._process) is None:
                    self._api.terminate(self._process, 1)
                self.returncode = self._api.wait(self._process, 5)
            except Exception:
                pass
        for action in (self._close_child_stdio,
                       lambda: self._close_owned_handle('_thread'),
                       lambda: self._close_owned_handle('_job'),
                       lambda: self._close_owned_handle('_process')):
            try:
                action()
            except Exception:
                pass
        for stream in (self.stdout, self.stderr):
            if stream is not None:
                try:
                    stream.close()
                except Exception:
                    pass
        self._closed = True

    def _handle(self):
        if self._closed or self._process is None:
            raise RuntimeError('owned_process_handle_closed')
        return self._process

    def poll(self):
        self.returncode = self._api.poll(self._handle())
        return self.returncode

    def wait(self, timeout=None):
        self.returncode = self._api.wait(self._handle(), timeout)
        return self.returncode

    def terminate(self):
        self._api.terminate(self._handle(), 1)

    def kill(self):
        self._api.terminate(self._handle(), 1)

    def close_owner(self):
        if self._closed:
            return
        self._closed = True
        error = None
        # Closing this unshared job kills only its direct assigned child. Its
        # descendants silently break away; an adb daemon is not a job member.
        for name in ('_job', '_thread', '_process'):
            try:
                self._close_owned_handle(name)
            except Exception:
                error = True
        if error:
            raise RuntimeError('owned_process_handle_close_failed')


class WindowsProcessApi:
    """Lazy Windows-only implementation. Construction loads API declarations."""

    def __init__(self):
        if os.name != 'nt':
            raise RuntimeError('windows_process_api_required')
        import ctypes
        from ctypes import wintypes
        import _winapi
        import msvcrt
        self.ctypes, self.w, self.winapi, self.msvcrt = ctypes, wintypes, _winapi, msvcrt
        self.k = ctypes.WinDLL('kernel32', use_last_error=True)
        ULONG_PTR = ctypes.c_size_t

        class BASIC(ctypes.Structure):
            _fields_ = [('PerProcessUserTimeLimit', ctypes.c_longlong),
                        ('PerJobUserTimeLimit', ctypes.c_longlong),
                        ('LimitFlags', wintypes.DWORD),
                        ('MinimumWorkingSetSize', ULONG_PTR),
                        ('MaximumWorkingSetSize', ULONG_PTR),
                        ('ActiveProcessLimit', wintypes.DWORD),
                        ('Affinity', ULONG_PTR), ('PriorityClass', wintypes.DWORD),
                        ('SchedulingClass', wintypes.DWORD)]

        class IO(ctypes.Structure):
            _fields_ = [(name, ctypes.c_ulonglong) for name in
                        ('ReadOperationCount', 'WriteOperationCount', 'OtherOperationCount',
                         'ReadTransferCount', 'WriteTransferCount', 'OtherTransferCount')]

        class EXTENDED(ctypes.Structure):
            _fields_ = [('BasicLimitInformation', BASIC), ('IoInfo', IO),
                        ('ProcessMemoryLimit', ULONG_PTR), ('JobMemoryLimit', ULONG_PTR),
                        ('PeakProcessMemoryUsed', ULONG_PTR), ('PeakJobMemoryUsed', ULONG_PTR)]

        self.extended_type = EXTENDED
        declarations = {
            'GetCurrentProcess': ([], wintypes.HANDLE),
            'GetCurrentProcessId': ([], wintypes.DWORD),
            'IsProcessInJob': ([wintypes.HANDLE, wintypes.HANDLE,
                                ctypes.POINTER(wintypes.BOOL)], wintypes.BOOL),
            'CreateJobObjectW': ([ctypes.c_void_p, wintypes.LPCWSTR], wintypes.HANDLE),
            'SetInformationJobObject': ([wintypes.HANDLE, ctypes.c_int,
                                         ctypes.c_void_p, wintypes.DWORD], wintypes.BOOL),
            'AssignProcessToJobObject': ([wintypes.HANDLE, wintypes.HANDLE], wintypes.BOOL),
            'GetProcessTimes': ([wintypes.HANDLE, ctypes.POINTER(wintypes.FILETIME),
                                 ctypes.POINTER(wintypes.FILETIME), ctypes.POINTER(wintypes.FILETIME),
                                 ctypes.POINTER(wintypes.FILETIME)], wintypes.BOOL),
            'ResumeThread': ([wintypes.HANDLE], wintypes.DWORD),
            'TerminateProcess': ([wintypes.HANDLE, wintypes.UINT], wintypes.BOOL),
            'WaitForSingleObject': ([wintypes.HANDLE, wintypes.DWORD], wintypes.DWORD),
            'GetExitCodeProcess': ([wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)], wintypes.BOOL),
            'CloseHandle': ([wintypes.HANDLE], wintypes.BOOL),
        }
        for name, (arguments, result) in declarations.items():
            function = getattr(self.k, name)
            function.argtypes, function.restype = arguments, result

    def _check(self, value):
        if not value:
            raise RuntimeError('windows_process_api_call_failed')
        return value

    def current_process(self):
        return self.k.GetCurrentProcess()

    def current_pid(self):
        return int(self.k.GetCurrentProcessId())

    def is_in_job(self, process):
        answer = self.w.BOOL()
        self._check(self.k.IsProcessInJob(process, None, self.ctypes.byref(answer)))
        return bool(answer.value)

    def create_job(self):
        # NULL security attributes make this private handle noninheritable.
        handle = self._check(self.k.CreateJobObjectW(None, None))
        try:
            limits = self.extended_type()
            limits.BasicLimitInformation.LimitFlags = JOB_LIMIT_FLAGS
            self._check(self.k.SetInformationJobObject(handle, 9,
                self.ctypes.byref(limits), self.ctypes.sizeof(limits)))
            return handle
        except Exception:
            self.close_handle(handle)
            raise

    def create_stdio(self, pipes):
        child_handles, parent_handles, streams = [], [], []
        try:
            def null_handle(access):
                # _winapi.CreateFile defaults to noninheritable; only these exact
                # NUL handles are made inheritable and whitelisted below.
                handle = self.winapi.CreateFile('NUL', access, 3, None, 3, 0, None)
                child_handles.append(handle)
                os.set_handle_inheritable(handle, True)
                return handle

            stdin = null_handle(0x80000000)
            if pipes:
                writers = []
                for _ in range(2):
                    reader, writer = self.winapi.CreatePipe(None, 0)
                    parent_handles.append(reader)
                    child_handles.append(writer)
                    os.set_handle_inheritable(reader, False)
                    os.set_handle_inheritable(writer, True)
                    descriptor = self.msvcrt.open_osfhandle(reader, os.O_RDONLY | os.O_BINARY)
                    parent_handles.remove(reader)  # descriptor now owns HANDLE
                    try:
                        stream = os.fdopen(descriptor, 'rb')
                    except Exception:
                        os.close(descriptor)
                        raise
                    streams.append(stream)
                    writers.append(writer)
                stdout_handle, stderr_handle = writers
                stdout, stderr = streams
            else:
                stdout_handle = stderr_handle = null_handle(0x40000000)
                stdout = stderr = None
            return dict(handles=dict(stdin=stdin, stdout=stdout_handle, stderr=stderr_handle),
                        child_handles=child_handles, stdout=stdout, stderr=stderr)
        except Exception:
            for handle in dict.fromkeys(child_handles + parent_handles):
                try:
                    self.close_handle(handle)
                except Exception:
                    pass
            for stream in streams:
                try:
                    stream.close()
                except Exception:
                    pass
            raise

    def create_suspended(self, args, cwd, handles):
        startup = subprocess.STARTUPINFO()
        startup.dwFlags |= subprocess.STARTF_USESTDHANDLES
        startup.hStdInput, startup.hStdOutput, startup.hStdError = (
            handles['stdin'], handles['stdout'], handles['stderr'])
        startup.lpAttributeList = {'handle_list': list(dict.fromkeys(handles.values()))}
        return self.winapi.CreateProcess(args[0], subprocess.list2cmdline(args), None,
            None, True, PROCESS_FLAGS, None, cwd, startup)[:3]

    def assign(self, job, process):
        self._check(self.k.AssignProcessToJobObject(job, process))

    def creation_filetime(self, process):
        creation, exit_time, kernel, user = (self.w.FILETIME() for _ in range(4))
        self._check(self.k.GetProcessTimes(process, self.ctypes.byref(creation),
            self.ctypes.byref(exit_time), self.ctypes.byref(kernel), self.ctypes.byref(user)))
        return (int(creation.dwHighDateTime) << 32) | int(creation.dwLowDateTime)

    def resume(self, thread):
        result = self.k.ResumeThread(thread)
        if result == 0xFFFFFFFF:
            raise RuntimeError('owned_process_resume_failed')
        return int(result)

    def poll(self, process):
        state = self.k.WaitForSingleObject(process, 0)
        if state == 258:
            return None
        if state != 0:
            raise RuntimeError('owned_process_wait_failed')
        code = self.w.DWORD()
        self._check(self.k.GetExitCodeProcess(process, self.ctypes.byref(code)))
        return int(code.value)

    def wait(self, process, timeout):
        if timeout is None:
            milliseconds = 0xFFFFFFFF
        else:
            if (not isinstance(timeout, (int, float)) or not math.isfinite(timeout)
                    or not 0 <= timeout <= 86400):
                raise ValueError('bounded_wait_required')
            milliseconds = int(math.ceil(timeout * 1000))
        result = self.k.WaitForSingleObject(process, milliseconds)
        if result == 258:
            raise subprocess.TimeoutExpired('owned_process', timeout)
        if result != 0:
            raise RuntimeError('owned_process_wait_failed')
        return self.poll(process)

    def terminate(self, process, code):
        self._check(self.k.TerminateProcess(process, code))

    def close_handle(self, handle):
        self._check(self.k.CloseHandle(handle))
