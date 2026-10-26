"""Fixed startup stages and private-safe receipts; no operation runs on import.

The caller supplies the already reviewed absolute diagnostic directory. It must
call python_entry() before importing operation/native modules. This recorder
never opens a review-selected path, starts a process, queries Windows or retries.
Every receipt and state snapshot is append-only. No shared state file is
replaced; partial/latest output is never proof of a successful startup. Status/native cleanup calls produce no steady-state write traffic.
"""
from datetime import datetime, timezone
import json
import os
from pathlib import Path


STAGES = frozenset({
    'python_entry', 'launcher_marker', 'startup_directory', 'owner_import',
    'review_path', 'review_read', 'authorization_read', 'source_validation',
    'seal_read', 'review_binding', 'owner_job_guard', 'output_reservation',
    'supervisor_identity', 'collector_identity', 'collector_start',
    'recording_watch', 'complete', 'native_api_load', 'native_create_job',
    'native_stdio', 'native_create_suspended', 'native_job_check',
    'native_job_assign', 'native_birth_read', 'native_resume', 'native_status',
    'native_wait', 'native_terminate', 'native_close',
})

STATUSES = frozenset({
    'startup_failed', 'recording_complete', 'stopped', 'STARTUP_COMPLETE',
    'STARTUP_STOPPED_NO_RETRY', 'RECORDING_COMPLETE', 'RECORDING_STOPPED',
    'TRANSPORT_STABILITY_PASSED', 'INTERRUPTED_OR_FAILED',
    'LAUNCH_STOPPED_NO_RETRY', 'OWNER_STARTUP_STOPPED_BEFORE_CAPTURE',
})

# A message is retained only when its entire sole argument is one of these
# source-defined codes. Never retain substrings, arbitrary args or str(exc).
KNOWN_CODES = frozenset({
    'owner_startup_binding_required', 'launcher_marker_missing',
    'launcher_marker_invalid', 'closed_or_used_session_cannot_resume',
    'startup_diagnostic_binding_required', 'startup_diagnostic_source_pins_required',
    'required_source_outside_operations',
    'collector_result_not_passed', 'capture_heartbeat_stale',
    'absolute_owner_deadline_reached', 'guardian_requires_owner_outside_job',
    'fresh_owner_window_scope_required', 'owner_source_binding_changed',
    'fresh_full_owner_window_required', 'exact_fresh_review_required',
    'owner_source_pins_required', 'sealed_python_collector_required',
    'explicit_timezone_required', 'one_use_record_already_exists',
    'owned_process_start_failed_no_retry', 'new_suspended_child_must_be_outside_jobs',
    'exactly_one_suspended_thread_required', 'child_stdio_close_failed',
    'owned_process_handle_closed', 'owned_process_handle_close_failed',
    'windows_process_api_required', 'windows_process_api_call_failed',
    'owned_process_resume_failed', 'owned_process_wait_failed',
    'bounded_wait_required', 'absolute_executable_and_literal_arguments_required',
    'explicit_pipe_mode_and_private_identity_callback_required',
    'capture_identity_or_scope_mismatch', 'collector_finalization_deadline_reached',
    'capture_startup_deadline_reached', 'local_supervision_failed',
    'local_stop_or_poll_failed', 'owned_child_exit_read_failed',
    'owned_child_cleanup_failed', 'collector_result_unreadable',
    'collector_exited_without_completion', 'supervisor_retirement_write_failed',
    'owner_requested_stop', 'bound_fresh_session_required', 'startup_journal_write_failed',
})

EXCEPTION_CLASSES = frozenset({
    'StartupJournalError',
    'KeyboardInterrupt', 'SystemExit', 'FileNotFoundError', 'PermissionError',
    'FileExistsError', 'TimeoutError', 'ModuleNotFoundError', 'ImportError',
    'SyntaxError', 'IndentationError', 'TabError', 'OSError', 'ValueError',
    'TypeError', 'RuntimeError', 'AttributeError', 'KeyError', 'AssertionError',
    'JSONDecodeError', 'TimeoutExpired',
})


def _utc():
    return datetime.now(timezone.utc).isoformat()


class StartupJournalError(RuntimeError):
    """A local receipt failure is a stop, never permission to continue."""


def _stage(stage):
    if stage not in STAGES:
        raise ValueError('startup_stage_not_allowed')
    return stage


def project_failure(stage, exc):
    """Pure allowlist projection; no exception text, path, traceback or arguments."""
    _stage(stage)
    kind = type(exc).__name__
    kind = kind if kind in EXCEPTION_CLASSES else 'OtherException'
    reason = {
        'KeyboardInterrupt': 'owner_interrupted',
        'FileNotFoundError': 'required_file_missing',
        'PermissionError': 'access_denied',
        'FileExistsError': 'one_use_record_exists',
        'ModuleNotFoundError': 'module_import_failed',
        'ImportError': 'module_import_failed',
        'SyntaxError': 'source_syntax_error',
        'IndentationError': 'source_syntax_error',
        'TabError': 'source_syntax_error',
        'JSONDecodeError': 'invalid_json',
        'TimeoutError': 'operation_timeout',
        'TimeoutExpired': 'operation_timeout',
    }.get(kind, 'unclassified_startup_failure')
    arguments = getattr(exc, 'args', ())
    if (isinstance(arguments, tuple) and len(arguments) == 1
            and isinstance(arguments[0], str) and arguments[0] in KNOWN_CODES):
        reason = arguments[0]
    value = dict(stage=stage, reason=reason, exceptionClass=kind)
    if type(exc) is StartupJournalError:
        operation = getattr(exc, 'diagnostic_operation', None)
        if operation in ('write_snapshot', 'write_receipt'):
            value['diagnosticOperation'] = operation
    try:
        code = getattr(exc, 'winerror', None)
    except Exception:
        code = None
    if type(code) is int and 0 <= code <= 65535:
        value['winerror'] = code
    return value


class Journal:
    def __init__(self, directory):
        self.directory = Path(directory)
        if not self.directory.is_absolute():
            raise ValueError('known_absolute_startup_directory_required')
        self._entered = self._finished = False
        self._first_failure = None
        self._current_stage = None
        self._sequence = 0

    @property
    def first_failure(self):
        return dict(self._first_failure) if self._first_failure is not None else None

    @property
    def current_stage(self):
        return self._current_stage

    def _write_once(self, name, value):
        try:
            with (self.directory / name).open('x', encoding='utf-8') as handle:
                json.dump(value, handle, indent=2)
                handle.write('\n')
                handle.flush()
                os.fsync(handle.fileno())
        except Exception as exc:
            error = StartupJournalError('startup_journal_write_failed')
            error.diagnostic_operation = ('write_snapshot'
                if name.startswith('startup-state-') else 'write_receipt')
            code = getattr(exc, 'winerror', None)
            if type(code) is int and 0 <= code <= 65535:
                error.winerror = code
            raise error from None

    def _state(self):
        value = dict(schemaVersion=1, at=_utc(), currentStage=self._current_stage,
                     firstFailure=self.first_failure, finished=self._finished,
                     rawExceptionTextSaved=False, tracebacksSaved=False,
                     commandArgumentsSaved=False, appendOnlySnapshot=True)
        self._sequence += 1
        self._write_once('startup-state-%06d.json' % self._sequence, value)

    def _ready(self):
        if not self._entered or self._finished:
            raise StartupJournalError('startup_journal_not_open')

    def python_entry(self):
        if self._entered or self._finished:
            raise StartupJournalError('startup_python_entry_already_consumed')
        try:
            self.directory.mkdir(parents=True, exist_ok=True)
        except Exception:
            raise StartupJournalError('startup_journal_write_failed') from None
        self._write_once('python-entry.json', dict(schemaVersion=1,
            at=_utc(), stage='python_entry', processQueries=0, processLaunches=0))
        self._entered = True
        self._current_stage = 'python_entry'
        self._state()

    def phase(self, stage, function, *args, **kwargs):
        self._ready()
        _stage(stage)
        self._current_stage = stage
        try:
            self._sequence += 1
            self._write_once('stage-entry-%06d.json' % self._sequence,
                             dict(schemaVersion=1, at=_utc(), stage=stage))
            self._state()
        except StartupJournalError as exc:
            # The logger itself failed. Latch the exact nested stage in memory,
            # stop before the operation, and do not try another receipt write.
            if self._first_failure is None:
                self._first_failure = dict(at=_utc(), **project_failure(stage, exc))
            raise
        try:
            return function(*args, **kwargs)
        except StartupJournalError:
            # Nested logging failure is already latched; do not relabel/rewrite.
            raise
        except (Exception, KeyboardInterrupt) as exc:
            self.fail(stage, exc)
            raise

    def fail(self, stage, exc):
        self._ready()
        _stage(stage)
        self._current_stage = stage
        if self._first_failure is None:
            self._first_failure = dict(at=_utc(), **project_failure(stage, exc))
            self._write_once('first-failure.json', dict(schemaVersion=1,
                **self._first_failure, rawExceptionTextSaved=False,
                tracebacksSaved=False, commandArgumentsSaved=False))
        self._state()
        return self.first_failure

    def finish(self, status):
        self._ready()
        if status not in STATUSES:
            raise ValueError('startup_status_not_allowed')
        self._finished = True
        actual = ('startup_failed' if status in ('startup_failed', 'recording_complete', 'stopped')
                  else 'STARTUP_STOPPED_NO_RETRY') if self._first_failure else status
        result = dict(schemaVersion=1, at=_utc(), status=actual,
            requestedStatus=status, currentStage=self._current_stage,
            firstFailure=self.first_failure, rawExceptionTextSaved=False,
            tracebacksSaved=False, commandArgumentsSaved=False)
        self._write_once('startup-result.json', result)
        self._state()
        return result


class TracingApi:
    """Inject around the existing native API; never instantiate it here."""
    STARTUP = {
        'create_job': 'native_create_job',
        'create_stdio': 'native_stdio',
        'create_suspended': 'native_create_suspended',
        'is_in_job': 'native_job_check',
        'assign': 'native_job_assign',
        'creation_filetime': 'native_birth_read',
        'resume': 'native_resume',
    }
    FAILURE_ONLY = {
        'current_process': 'native_status', 'current_pid': 'native_status',
        'poll': 'native_status', 'wait': 'native_wait',
        'terminate': 'native_terminate', 'close_handle': 'native_close',
    }

    def __init__(self, native, journal):
        self._native, self._journal = native, journal

    def __getattr__(self, name):
        if name not in self.STARTUP and name not in self.FAILURE_ONLY:
            raise AttributeError('native_api_method_not_allowed')

        def invoke(*args, **kwargs):
            if name in self.STARTUP:
                return self._journal.phase(self.STARTUP[name],
                    lambda: getattr(self._native, name)(*args, **kwargs))
            try:
                return getattr(self._native, name)(*args, **kwargs)
            except (Exception, KeyboardInterrupt) as exc:
                self._journal.fail(self.FAILURE_ONLY[name], exc)
                raise

        return invoke
