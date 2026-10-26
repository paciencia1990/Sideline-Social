"""Offline-testable logging state; no device, network, file or app operations."""
import re

ENTRY = re.compile(r'^\s*(\d{9,11}\.\d+)\s+(\d+)\s+\d+\s+([VDIWEF])\s+(.+)$')
MAX_BYTES, MAX_LINES, MAX_LINE, MAX_EVENTS = 8388608, 20000, 65536, 512
ATTACH_SECONDS = 5


def logcat_arguments(serial, pid):
    if not re.fullmatch(r'[A-Za-z0-9._-]+', serial) or serial.startswith('emulator-'):
        raise ValueError('physical_phone_required')
    if not re.fullmatch(r'[1-9][0-9]{0,7}', pid):
        raise ValueError('one_existing_app_process_required')
    # Explicit display priority includes INFO; never inherit a silent tag filter.
    return ['-s', serial, 'logcat', '-b', 'main', '-v', 'epoch',
            '-T', '1', '--pid=' + pid, '*:I']


def stderr_category(raw):
    """Return only a fixed category. Never return stderr text or identifiers."""
    text = raw.decode('utf-8', errors='replace').lower()
    if not text.strip():
        return None
    for code, pattern in (
            ('device_unauthorized', r'unauthorized'),
            ('device_disconnected', r'device.*(?:offline|not found)|no devices|disconnected|closed'),
            ('log_permission_denied', r'permission denied|not permitted|access denied'),
            ('log_option_unsupported', r'unknown option|unrecognized option|invalid option'),
            ('log_reader_failed', r'logcat read failure|unexpected eof|logd not running')):
        if re.search(pattern, text):
            return code
    return 'stream_stderr_reported'


class Readiness:
    def __init__(self, pid, started_mono, ends_mono, device_offset, uncertainty,
                 started_host_epoch):
        if (ends_mono <= started_mono or uncertainty < 0
                or not re.fullmatch(r'[1-9][0-9]{0,7}', pid)
                or not 1500000000 <= started_host_epoch <= 4000000000):
            raise ValueError('invalid_capture_bounds')
        self.pid = pid
        self.started = started_mono
        self.ends = ends_mono
        self.offset = device_offset
        self.uncertainty = uncertainty
        self.started_host = started_host_epoch
        self.bytes = self.lines = self.sequence = self.safe_events = 0
        self.app_lines = 0
        self.last_app_epoch = None
        self.boundary = None
        self.delivery_after_boundary = False
        self.fault = None
        self.eof = False

    def fail(self, category):
        if self.fault is None:
            self.fault = category

    def stderr(self, raw):
        category = stderr_category(raw)
        if category:
            self.fail(category)

    def begin_plans_boundary(self, boundary_id, host_epoch, received_mono):
        if (self.boundary is not None or not boundary_id
                or not self.started <= received_mono < self.ends
                or not self.started_host <= host_epoch
                <= self.started_host + received_mono - self.started + 1):
            raise ValueError('plans_boundary_invalid_or_already_set')
        self.boundary = {'id': boundary_id, 'hostEpoch': host_epoch,
                         'mono': received_mono, 'sequence': self.sequence}

    def line(self, raw, received_mono):
        self.bytes += len(raw)
        self.lines += 1
        if (self.bytes > MAX_BYTES or self.lines > MAX_LINES or len(raw) > MAX_LINE
                or not raw.endswith(b'\n')):
            self.fail('stream_data_limit_or_incomplete_line')
            return False
        if not self.started <= received_mono < self.ends:
            return False
        match = ENTRY.match(raw.decode('utf-8', errors='replace'))
        if not match or match.group(2) != self.pid:
            return False
        epoch = float(match.group(1))
        upper_epoch = (self.started_host + received_mono - self.started
                       + self.offset + self.uncertainty)
        if not 1500000000 <= epoch <= min(4000000000, upper_epoch):
            return False
        self.sequence += 1
        self.app_lines += 1
        self.last_app_epoch = epoch
        if self.boundary:
            b = self.boundary
            # Receiving buffered history late cannot satisfy this requirement.
            if (self.sequence > b['sequence'] and received_mono > b['mono']
                    and epoch > b['hostEpoch'] + self.offset + self.uncertainty):
                self.delivery_after_boundary = True
        return True

    def safe_event(self):
        self.safe_events += 1
        if self.safe_events >= MAX_EVENTS:
            self.fail('safe_event_limit_reached')

    def snapshot(self, now_mono, process_running, stdout_reader_running, stderr_monitor_started):
        healthy = (process_running and stdout_reader_running and stderr_monitor_started
                   and not self.eof and self.fault is None and now_mono < self.ends)
        attached = healthy and now_mono - self.started >= ATTACH_SECONDS
        return {
            'schemaVersion': 2,
            'live': bool(healthy),
            'transportReadyForPlansOnly': bool(attached),
            'readiness': ('stopped' if not healthy else 'attaching' if not attached
                          else 'app_log_delivery_observed' if self.app_lines
                          else 'transport_attached_idle'),
            'appLogDeliveryObserved': self.app_lines > 0,
            'appLogSincePlansAuthorization': self.delivery_after_boundary,
            'plansBoundaryId': self.boundary['id'] if self.boundary else None,
            'logCausedByPlansProven': False,
            'billingSuccessProven': False,
            'fault': self.fault,
            'eof': self.eof,
            'streamProcessRunning': bool(process_running),
            'stdoutReaderRunning': bool(stdout_reader_running),
            'stderrMonitorStarted': bool(stderr_monitor_started),
            'scannedBytes': self.bytes, 'scannedLines': self.lines,
            'validAppLines': self.app_lines,
        }
