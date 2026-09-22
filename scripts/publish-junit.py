#!/usr/bin/env python3
"""Publish a JUnit report into an existing Kontur test run. No third-party packages."""
import argparse, hashlib, json, os, sys, uuid, urllib.request, urllib.error
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlsplit

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--file',required=True);parser.add_argument('--run-id',type=int,required=True)
    parser.add_argument('--base-url',required=True);parser.add_argument('--request-id',help='Stable UUID from the CI job; optional, otherwise derived from run and report bytes')
    parser.add_argument('--packet-file',help='JSON checkpoint for retrying the exact same request')
    args=parser.parse_args();token=os.environ.get('KONTUR_API_TOKEN')
    target=urlsplit(args.base_url)
    if target.scheme!='https' or target.username or target.password or target.query or target.fragment or args.run_id<=0 or not token:parser.error('Use an HTTPS base URL, positive run ID and KONTUR_API_TOKEN')
    raw=Path(args.file).read_bytes()
    if len(raw)>10_000_000 or b'<!DOCTYPE' in raw or b'<!ENTITY' in raw:parser.error('Report is too large or contains a DTD/entity declaration')
    root=ET.fromstring(raw)
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*_args,**_kwargs):return None
    opener=urllib.request.build_opener(NoRedirect)
    def api(path,body=None):
        req=urllib.request.Request(args.base_url.rstrip('/')+'/api/work/'+path,data=json.dumps(body).encode() if body is not None else None,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
        with opener.open(req,timeout=30) as response:return json.load(response)
    packet_path=Path(args.packet_file or (args.file+'.kontur-run-'+str(args.run_id)+'.json'))
    identity={'base_url':args.base_url.rstrip('/'),'run_id':args.run_id,'report_sha256':hashlib.sha256(raw).hexdigest()}
    if packet_path.exists():
        saved=json.loads(packet_path.read_text())
        if saved.get('identity')!=identity:parser.error('Checkpoint belongs to another report; choose a new --packet-file')
        if args.request_id and saved['packet']['request_id']!=str(uuid.UUID(args.request_id)):parser.error('Checkpoint has another request ID')
        print(json.dumps(api('quality/runs/'+str(args.run_id)+'/results',saved['packet']),ensure_ascii=False));return
    run=api('quality/runs/'+str(args.run_id));keys={i['snapshot'].get('automation_key'):i for i in run['items'] if i['snapshot'].get('automation_key')}
    results=[];seen=set();unknown=[]
    for case in root.iter('testcase'):
        key='.'.join(filter(None,[case.get('classname'),case.get('name')]))
        if key not in keys:unknown.append(key);continue
        if key in seen:parser.error('Duplicate automation key in report: '+key)
        seen.add(key);item=keys[key];failure=case.find('failure');error=case.find('error');skipped=case.find('skipped')
        detail=failure if failure is not None else error if error is not None else skipped
        result='failed' if failure is not None or error is not None else 'skipped' if skipped is not None else 'passed'
        note=((detail.get('message','')+'\n'+(detail.text or '')) if detail is not None else '').strip()[:10000]
        results.append({'case_id':item['case_id'],'revision':item['revision'],'result':result,'notes':note,'defect_task_id':item.get('defect_task_id')})
    if unknown:parser.error('Unmapped test cases: '+', '.join(unknown[:20]))
    if not results or len(results)>500:parser.error('Expected 1–500 mapped test results')
    # UUID identifies this publication. Save the exact JSON packet for retry: server fingerprints revisions too.
    request_id=str(uuid.UUID(args.request_id)) if args.request_id else str(uuid.uuid5(uuid.NAMESPACE_URL,args.base_url+':'+str(args.run_id)+':'+hashlib.sha256(raw).hexdigest()))
    packet={'request_id':request_id,'results':results}
    with packet_path.open('x',encoding='utf-8') as file:json.dump({'identity':identity,'packet':packet},file,ensure_ascii=False)
    print(json.dumps(api('quality/runs/'+str(args.run_id)+'/results',packet),ensure_ascii=False))
if __name__=='__main__':
    try:main()
    except urllib.error.HTTPError as error:
        print('Kontur API returned HTTP '+str(error.code)+'. Check rights, mappings and run revisions.',file=sys.stderr);sys.exit(1)
    except Exception as error:
        print(type(error).__name__+': publication failed. Credentials are not logged.',file=sys.stderr);sys.exit(1)
