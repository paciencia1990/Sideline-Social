"""Bounded capture diagnostics and existing-pipe lifecycle; no process launcher.

Future reviewed collectors supply their ONE already-open child, existing safe
projector and retirement callback. This module cannot connect, restart, run adb,
authenticate, change billing or issue an app action. Historical collectors stay
immutable. Diagnostic output contains fixed categories and counts, never text.
"""
import re
import queue
import threading
import time

from coach_ai_log_readiness import ENTRY, MAX_BYTES, MAX_LINE, MAX_LINES
from coach_ai_log_termination import stop_reason, termination_evidence

TERMINAL_LIMIT = 8192
PREFIX_LIMIT = 4096
LAUNCH_FACTS = dict(shell=False, stdin='devnull', stdout='pipe', stderr='pipe',
                    windowsNoWindow=True, pythonChildTimeoutSeconds=None)
FAULT_PATTERNS = (
    ('device_unauthorized', r'\bdevice\b[^\n]{0,100}\bunauthorized\b'),
    ('device_disconnected', r'\bdevice\b[^\n]{0,100}\b(?:offline|not found)\b|\bno devices(?:/emulators)? found\b'),
    ('log_permission_denied', r'\b(?:permission denied|operation not permitted|access denied)\b'),
    ('log_option_unsupported', r'\b(?:unknown|unrecognized|invalid) option\b'),
    ('log_reader_failed', r'\b(?:logcat read failure|unexpected eof|logd not running)\b'),
    ('adb_transport_failed', r'\b(?:transport error|protocol fault|connection reset by peer|broken pipe)\b'),
)


class TerminalDiagnostics:
    """Caller serializes access. Retain at most a 4KiB prefix per channel."""

    def __init__(self):
        self.channels = {name: dict(bytes=0, chunks=0, appLines=0,
            terminalLines=0, headerLines=0, blankLines=0, unknownLines=0,
            unterminatedLines=0, truncatedLines=0, eof=False, readerFailed=False)
            for name in ('stdout', 'stderr')}
        self.pending = {name: bytearray() for name in self.channels}
        self.truncated = {name: False for name in self.channels}
        self.categories = set()
        self.terminal_bytes = 0
        self.limit_reached = False
        self.fault = None

    def _fault(self, value):
        self.categories.add(value)
        if self.fault is None:
            self.fault = value

    def observe(self, channel, raw, *, app_line=False):
        info = self.channels[channel]
        if info['eof'] or not isinstance(raw, bytes):
            raise ValueError('open_channel_bytes_required')
        info['bytes'] += len(raw)
        info['chunks'] += 1
        if app_line:
            if channel != 'stdout' or self.pending[channel]:
                raise ValueError('whole_app_stdout_line_required')
            info['appLines'] += 1
            return
        # Count all received bytes, but inspect only the remaining terminal budget.
        remaining = max(0, TERMINAL_LIMIT - self.terminal_bytes)
        inspected = raw[:remaining]
        self.terminal_bytes += len(raw)
        if len(raw) > remaining:
            self.limit_reached = True
            self._fault('terminal_diagnostic_limit_reached')
        for part in inspected.splitlines(keepends=True):
            ended = part.endswith(b'\n')
            room = PREFIX_LIMIT - len(self.pending[channel])
            self.pending[channel].extend(part[:room])
            self.truncated[channel] |= len(part) > room
            if ended:
                self._line(channel, unterminated=False)
        # A bounded oversized prefix is a failure, never a reason to read more.
        if self.truncated[channel]:
            self._fault('terminal_diagnostic_limit_reached')

    def _line(self, channel, *, unterminated):
        info = self.channels[channel]
        text = self.pending[channel].decode('utf-8', errors='replace').lower().strip()
        info['terminalLines'] += 1
        info['unterminatedLines'] += int(unterminated)
        info['truncatedLines'] += int(self.truncated[channel])
        if not text:
            info['blankLines'] += 1
        elif channel == 'stdout' and re.fullmatch(r'-+ beginning of (?:main|system|crash|events)', text):
            info['headerLines'] += 1
        else:
            found = [code for code, pattern in FAULT_PATTERNS if re.search(pattern, text)]
            if found:
                for code in found:
                    self._fault(code)
            else:
                info['unknownLines'] += 1
                if channel == 'stderr':
                    self._fault('stream_stderr_reported')
        if self.truncated[channel]:
            self.limit_reached = True
            self._fault('terminal_diagnostic_limit_reached')
        self.pending[channel].clear()
        self.truncated[channel] = False

    def flush_partial(self, channel):
        if self.pending[channel] or self.truncated[channel]:
            self._line(channel, unterminated=True)

    def closed(self, channel):
        self.flush_partial(channel)
        self.channels[channel]['eof'] = True

    def reader_failed(self, channel):
        self.channels[channel]['readerFailed'] = True
        self._fault('stream_reader_failed' if channel == 'stdout' else 'stderr_reader_failed')

    def snapshot(self):
        return dict(schemaVersion=1,
            channels={key: dict(value, pendingPrefixBytes=len(self.pending[key]))
                      for key, value in self.channels.items()},
            terminalBytesObserved=self.terminal_bytes,
            diagnosticLimitReached=self.limit_reached,
            categories=sorted(self.categories), firstFault=self.fault,
            rawOutputSaved=False, outputTextHashesSaved=False,
            physicalDisconnectProven=False, hostTimeoutProven=False,
            reconnectAllowed=False)


class CaptureStream:
    """One pair of pumps for an existing child, plus fail-closed retirement.

    project(raw) uses the existing pinned, privacy-safe app projector. emit(event)
    enqueues its already-safe output only. retire(receipt) atomically retires BOTH
    live eligibility and the Restore witness. It runs BEFORE any bounded drain.
    Cleanup/termination stays with the caller, AFTER finish() freezes evidence.
    """

    def __init__(self, process, state, project, emit, *, collector_started_mono,
                 adb_started_mono, planned_end_mono, launch_facts, clock=time.monotonic):
        if not collector_started_mono <= adb_started_mono < planned_end_mono:
            raise ValueError('ordered_launch_and_end_required')
        if launch_facts != LAUNCH_FACTS:
            raise ValueError('reviewed_direct_pipe_launch_required')
        self.process, self.state, self.project, self.emit = process, state, project, emit
        self.collector_started, self.adb_started = collector_started_mono, adb_started_mono
        self.end, self.clock = planned_end_mono, clock
        self.lock = threading.RLock()
        self.diagnostics = TerminalDiagnostics()
        self.stop = threading.Event()
        self.retired = self.started = self.finished = False
        self.first_exit = None
        self.started_events = {name: threading.Event() for name in ('stdout', 'stderr')}
        self.readers = {name: threading.Thread(target=self._pump, args=(name,), daemon=True)
                        for name in ('stdout', 'stderr')}

    def start(self):
        if self.started or self.retired:
            raise RuntimeError('capture_pumps_are_one_use')
        self.started = True
        for reader in self.readers.values():
            reader.start()

    def _pump(self, channel):
        self.started_events[channel].set()
        pipe = getattr(self.process, channel)
        try:
            while not self.stop.is_set():
                with self.lock:
                    if channel == 'stdout':
                        if self.state.bytes >= MAX_BYTES or self.state.lines >= MAX_LINES:
                            self.state.fail('stream_limit_reached')
                            return
                        size = min(MAX_LINE + 1, MAX_BYTES - self.state.bytes)
                    else:
                        size = min(PREFIX_LIMIT, TERMINAL_LIMIT - self.diagnostics.terminal_bytes + 1)
                        if size <= 0:
                            return
                raw = pipe.readline(size)
                with self.lock:
                    if not raw:
                        self.diagnostics.closed(channel)
                        if channel == 'stdout':
                            self.state.eof = True
                        return
                    # Recognize app framing even at EOF/cutoff. Never classify app
                    # message bodies as transport diagnostics or retain their text.
                    match = ENTRY.match(raw[:PREFIX_LIMIT].decode('utf-8', errors='replace')) if channel == 'stdout' else None
                    app_line = bool(match and match.group(2) == self.state.pid)
                    self.diagnostics.observe(channel, raw, app_line=app_line)
                    if channel == 'stdout':
                        valid = self.state.line(raw, self.clock())
                        if valid and not self.retired:
                            safe = self.project(raw)
                            if safe:
                                self.state.safe_event()
                                self.emit(safe)
                    if self.diagnostics.fault or self.state.fault:
                        return
                raw = b''
        except queue.Full:
            with self.lock:
                self.state.fail('event_queue_limit')
        except Exception:
            with self.lock:
                self.diagnostics.reader_failed(channel)
                self.state.fail('stream_reader_failed' if channel == 'stdout' else 'stderr_reader_failed')
        finally:
            with self.lock:
                # A limit/fault may stop a reader before a later empty read.
                # Classify its bounded final fragment without inventing EOF.
                self.diagnostics.flush_partial(channel)

    def _observe_exit(self):
        code = self.process.poll()
        if code is not None and self.first_exit is None:
            self.first_exit = dict(returnCode=code, adbElapsedSeconds=round(max(0, self.clock()-self.adb_started), 3))
        return code

    def failure_reason(self):
        with self.lock:
            code = self._observe_exit()
            return self.diagnostics.fault or stop_reason(code, self.state.eof,
                self.diagnostics.channels['stderr']['eof'],
                self.readers['stdout'].is_alive(), self.started_events['stderr'].is_set(),
                self.readers['stderr'].is_alive(), self.state.fault)

    def snapshot(self):
        with self.lock:
            code = self._observe_exit()
            return self.state.snapshot(self.clock(), code is None and not self.retired and not self.diagnostics.fault,
                self.readers['stdout'].is_alive() and not self.retired,
                self.started_events['stderr'].is_set() and self.readers['stderr'].is_alive() and not self.retired)

    def finish(self, retire, *, expected_stop=False):
        if self.finished:
            raise RuntimeError('capture_finish_is_one_use')
        self.finished = True
        with self.lock:
            self.retired = True
            code = self._observe_exit()
            before = termination_evidence(process_started=True, return_code=code,
                stdout_eof=self.state.eof, stderr_eof=self.diagnostics.channels['stderr']['eof'],
                stdout_alive=self.readers['stdout'].is_alive(), stderr_alive=self.readers['stderr'].is_alive(),
                fault=self.state.fault, elapsed_seconds=min(3600, max(0, self.clock()-self.adb_started)),
                expected_stop=expected_stop)
            retired = {**self.snapshot(), 'live': False, 'transportReadyForPlansOnly': False}
        # No joins/cleanup/extra commands before publication. A failed publication
        # is recorded; the outer supervisor must also reject a stale heartbeat.
        published = True
        try:
            retire(retired)
        except Exception:
            published = False
        # Only drain an ALREADY EXITED child. At most 1 second TOTAL, capped by
        # the existing end time. This neither waits for new phone data nor retries.
        drain_start = self.clock()
        drain_end = min(self.end, drain_start + 1.0)
        if code is not None:
            for reader in self.readers.values():
                if reader.ident is not None:
                    reader.join(timeout=max(0, drain_end-self.clock()))
        self.stop.set()
        with self.lock:
            after = self.diagnostics.snapshot()
            return dict(schemaVersion=1, beforeCleanup=before, diagnostics=after,
                firstExitObservation=self.first_exit,
                retirementPublished=published, retirementBeforeDrain=True,
                existingPipeDrainComplete=all(not self.readers[channel].is_alive()
                    and after['channels'][channel]['eof']
                    and not after['channels'][channel]['readerFailed']
                    for channel in ('stdout', 'stderr')),
                boundedDrainSeconds=round(max(0, self.clock()-drain_start), 3),
                lifecycle=dict(collectorElapsedSeconds=round(max(0, self.clock()-self.collector_started), 3),
                    adbElapsedSeconds=round(max(0, self.clock()-self.adb_started), 3),
                    plannedAdbSeconds=round(self.end-self.adb_started, 3),
                    expectedStop=expected_stop, launchFacts=dict(LAUNCH_FACTS),
                    externalHostTimeoutKnown=False),
                reconnects=0, restarts=0, deviceCommandsAdded=0,
                reportedFailureCategoryAvailable=bool(set(after['categories']) &
                    {category for category, _ in FAULT_PATTERNS}))
