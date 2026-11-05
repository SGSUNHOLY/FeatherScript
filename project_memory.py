"""Authenticated bridge-to-desktop project memory proxy; no website URLs."""
import json
import os
import urllib.request
import urllib.error


def request(message):
    port, token = os.environ.get('FS_PROJECT_PORT', ''), os.environ.get('FS_PROJECT_TOKEN', '')
    if not port.isdigit() or not token:
        raise RuntimeError('Project memory needs the running FeatherScript desktop app. Restart it after updating.')
    query = urllib.request.Request(f'http://127.0.0.1:{int(port)}/projects',
        data=json.dumps(message).encode('utf-8'), headers={'X-FS-Project-Token': token, 'Content-Type': 'application/json'})
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(query, timeout=8) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        try:
            detail = json.load(error).get('error', 'Project memory request failed.')
        except (ValueError, AttributeError):
            detail = 'Project memory request failed.'
        raise RuntimeError(detail) from None


def detect_place(call):
    try:
        result = call('get_place_info', {}, 4)
        data = json.loads(result.get('text', ''))
        place_id = data.get('placeId')
        if isinstance(place_id, bool) or not isinstance(place_id, int) or place_id <= 0:
            return None
        return {'kind': 'roblox', 'key': f'place:{place_id}', 'name': str(data.get('name') or f'Place {place_id}')[:200]}
    except Exception:
        # Unpublished or unavailable places cannot safely be grouped by name.
        return None
