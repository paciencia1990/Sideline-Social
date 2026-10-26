"""Only local allowlisted projection and atomic publication; no device/network."""
import json,re
from datetime import datetime,timezone
def register_restore_boundary(request,session,capture_id,sequence,now):
    at=datetime.fromisoformat(request['requestedAtUtc'].replace('Z','+00:00')).timestamp()
    if (request.get('sessionId')!=session or request.get('captureId')!=capture_id
        or request.get('phase') not in ('restoreA','restoreB')
        or not re.fullmatch('[a-f0-9]{32}',request.get('boundaryId','')) or not 0<=now-at<=3):
        raise RuntimeError('fresh_restore_boundary_required')
    return {'sessionId':session,'captureId':capture_id,'phase':request['phase'],'boundaryId':request['boundaryId'],
        'sequenceAtRegistration':sequence,'registeredAtUtc':datetime.fromtimestamp(now,timezone.utc).isoformat()}
def project_event(safe,sequence,offset,uncertainty,received):
    # The input is the existing hash-pinned sanitizer's projection, never a raw line.
    fields=('deviceEpoch','categories','billingResponseCodes','sdkErrorNames','progressCategories',
        'localPurchaseErrorKinds','product','productType','exactReason','reason','unknownReasonNotRetained')
    result={key:safe[key] for key in fields if key in safe}
    epoch=safe['deviceEpoch']
    result.update(sequence=sequence,hostEarliestMs=(epoch-offset-uncertainty)*1000,
        hostLatestMs=(epoch-offset+uncertainty)*1000,receivedAtMs=received*1000)
    return result
def publish_witness(folder,session,capture_id,events,boundaries,live,now):
    if len(events)>512:raise RuntimeError('witness_event_limit')
    value={'schemaVersion':1,'sessionId':session,'captureId':capture_id,'live':bool(live),
        'at':datetime.fromtimestamp(now,timezone.utc).isoformat(),'events':events,'boundaries':boundaries,
        'rawLogsSaved':False,'patternCountsAreNotCallCounts':True}
    pending=folder/'capture-witness.pending'
    pending.write_text(json.dumps(value),encoding='utf-8')
    pending.replace(folder/'capture-witness.json')
