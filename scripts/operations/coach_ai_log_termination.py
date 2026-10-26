"""Safe pre-cleanup observations; no device, process, file or network operations.

A closed pipe does not prove why adb stopped, or even that adb already exited.
Never infer a USB disconnect from EOF alone. The caller still stops immediately.
"""

SAFE_FAULTS = frozenset({
    'device_unauthorized', 'device_disconnected', 'log_permission_denied',
    'log_option_unsupported', 'log_reader_failed', 'stream_stderr_reported',
    'stderr_limit_reached', 'stderr_reader_failed', 'stream_reader_failed',
    'event_queue_limit', 'stream_data_limit_or_incomplete_line',
    'safe_event_limit_reached', 'stream_limit_reached',
})


def stop_reason(return_code, stdout_eof, stderr_eof, stdout_alive,
                stderr_started, stderr_alive, fault):
    """Stop on every lost channel; prefer a known fixed category over generic EOF."""
    if fault:
        return fault if fault in SAFE_FAULTS else 'uncategorized_capture_fault'
    if return_code is not None:
        return 'adb_process_exited_unexpectedly'
    if stdout_eof:
        return 'stdout_closed_while_adb_running'
    if stderr_eof:
        return 'stderr_closed_while_adb_running'
    if not stdout_alive:
        return 'stdout_reader_stopped'
    if stderr_started and not stderr_alive:
        return 'stderr_reader_stopped'
    return None


def termination_evidence(*, process_started, return_code, stdout_eof, stderr_eof,
                         stdout_alive, stderr_alive, fault, elapsed_seconds,
                         expected_stop):
    """Only fixed categories, booleans and bounded numbers may leave the recorder."""
    if type(process_started) is not bool or type(expected_stop) is not bool:
        raise ValueError('invalid_termination_flags')
    if return_code is not None and (type(return_code) is not int
                                   or not -(2**31) <= return_code <= 2**32 - 1):
        raise ValueError('invalid_process_return_code')
    if not isinstance(elapsed_seconds, (int, float)) or not 0 <= elapsed_seconds <= 3600:
        raise ValueError('invalid_capture_duration')
    fixed_fault = fault if fault in SAFE_FAULTS else 'uncategorized_capture_fault' if fault else None
    reason = (stop_reason(return_code, stdout_eof, stderr_eof, stdout_alive,
                          True, stderr_alive, fixed_fault) if process_started else 'stream_not_started')
    if expected_stop and reason is None:
        reason = 'approved_capture_stop'
    return {
        'schemaVersion': 1,
        'observedBeforeCleanup': True,
        'processStarted': process_started,
        'processRunningBeforeCleanup': process_started and return_code is None,
        'processReturnCodeBeforeCleanup': return_code,
        'stdoutEofBeforeCleanup': bool(stdout_eof),
        'stderrEofBeforeCleanup': bool(stderr_eof),
        'stdoutReaderRunningBeforeCleanup': bool(stdout_alive),
        'stderrReaderRunningBeforeCleanup': bool(stderr_alive),
        'safeFaultBeforeCleanup': fixed_fault,
        'elapsedSeconds': round(elapsed_seconds, 3),
        'expectedStop': expected_stop,
        'observedStopCategory': reason or 'capture_stopped_without_transport_fault',
        'physicalDisconnectProven': False,
        'rawStderrSaved': False,
        'identifiersSaved': False,
        'reconnectAllowed': False,
    }
