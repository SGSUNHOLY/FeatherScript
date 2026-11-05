"""PC tool schema and authenticated transport to the running desktop app."""
import contextvars
import json
import os
import time
import urllib.error
import urllib.request

CLIENT_ORIGIN = contextvars.ContextVar('computer_client_origin', default='')
_verdict_cache = (0, None)


def schema(name, description, properties=None, required=None):
    return {'name': name, 'description': description, 'server': 'computer', 'inputSchema': {
        'type': 'object', 'properties': properties or {}, 'required': required or [], 'additionalProperties': False}}


PATH = {'type': 'string', 'description': 'Absolute local filesystem path.'}
TEXT = {'type': 'string', 'description': 'UTF-8 text.'}
TOOLS = [
    schema('pc_system_info', 'Get local OS, home folder and available memory. Subject to desktop PC permissions.'),
    schema('pc_stat_path', 'Describe one file or folder: type, size and timestamps.', {'path': PATH}, ['path']),
    schema('pc_list_directory', 'List up to 500 entries in a local folder.', {'path': PATH}, ['path']),
    schema('pc_search_files', 'Find files or folders by name pattern under a folder. Does not follow links.', {
        'path': PATH, 'pattern': {'type': 'string', 'description': 'Name pattern; * and ? are wildcards.'},
        'maxResults': {'type': 'integer', 'minimum': 1, 'maximum': 500},
        'maxDepth': {'type': 'integer', 'minimum': 0, 'maximum': 8},
        'filesOnly': {'type': 'boolean'}}, ['path', 'pattern']),
    schema('pc_read_file', 'Read a UTF-8 text file, up to 1 MB. Optionally read a line range.', {
        'path': PATH, 'startLine': {'type': 'integer', 'minimum': 1}, 'maxLines': {'type': 'integer', 'minimum': 1, 'maximum': 20000}}, ['path']),
    schema('pc_write_file', 'Create or replace a local UTF-8 file, up to 2 MB. Its parent must exist.', {'path': PATH, 'text': TEXT}, ['path', 'text']),
    schema('pc_append_file', 'Append UTF-8 text to an existing local file, up to 1 MB per call.', {'path': PATH, 'text': TEXT}, ['path', 'text']),
    schema('pc_create_directory', 'Create a directory inside an existing parent.', {'path': PATH}, ['path']),
    schema('pc_copy_path', 'Copy a file or folder. Refuses an existing destination or a link.', {'source': PATH, 'destination': PATH}, ['source', 'destination']),
    schema('pc_move_path', 'Move or rename a file/folder. Refuses a destination that already exists when checked.', {'source': PATH, 'destination': PATH}, ['source', 'destination']),
    schema('pc_trash_path', 'Move a file/folder to the system trash/recycle bin. Always considered unusual.', {'path': PATH}, ['path']),
    schema('pc_open_path', 'Open an existing local file/folder with its default application.', {'path': PATH}, ['path']),
    schema('pc_open_url', 'Open an http(s) URL in the default browser. Always considered unusual.', {'url': {'type': 'string'}}, ['url']),
    schema('pc_clipboard_read', 'Read the current clipboard text. Always considered unusual because it may contain secrets.', {}),
    schema('pc_clipboard_write', 'Replace the clipboard with text, up to 1 MB. Always considered unusual.', {'text': TEXT}, ['text']),
    schema('pc_run_program', 'Run a program with explicit arguments as the current OS user. Programs can access the entire account. Always asks in unusual mode; subject to pairing and desktop permissions.', {
        'program': {'type': 'string'}, 'args': {'type': 'array', 'items': {'type': 'string'}, 'maxItems': 100},
        'cwd': PATH, 'timeoutMs': {'type': 'integer', 'minimum': 1000, 'maximum': 60000}}, ['program']),
]
with open(os.path.join(os.path.dirname(__file__), 'featherscript-app', 'computer-tool-catalog.json'), encoding='utf-8-sig') as _catalog_file:
    _catalog = json.load(_catalog_file)
TOOLS.extend({'name': item['name'], 'description': item['description'], 'server': 'computer',
              'inputSchema': item['inputSchema']} for item in _catalog)
NAMES = {tool['name'] for tool in TOOLS}
if len(NAMES) != len(TOOLS):
    raise RuntimeError('Duplicate computer tool definitions')

from tool_groups import GroupedCatalogue

def _operation_group(name):
    action = name.removeprefix('pc_')
    if action.startswith('git_'):
        return 'pc_git_operations', action.removeprefix('git_')
    if action.startswith(('json_', 'csv_', 'text_', 'markdown_', 'regex_')):
        return 'pc_data_operations', action
    if action in {'disk_space', 'env_vars', 'which', 'network_interfaces', 'process_list', 'dns_lookup', 'port_probe', 'http_get'}:
        return 'pc_system_operations', action
    return 'pc_file_operations', action

_OPERATION_GROUPS = GroupedCatalogue(TOOLS[-len(_catalog):], _operation_group, {
    'pc_git_operations': 'Read repository status, diffs, history and other Git metadata.',
    'pc_data_operations': 'Inspect or edit structured files and text. Desktop permissions apply per operation.',
    'pc_system_operations': 'Inspect local system and network state. Desktop permissions apply per operation.',
    'pc_file_operations': 'Inspect, search or edit local files. Desktop permissions apply per operation.',
}, 'pc_operation_schema', server='computer')
# Original operation names remain routable for saved tasks. Only the lean surface is advertised.
TOOLS = TOOLS[:-len(_catalog)] + _OPERATION_GROUPS.definitions
NAMES.update(_OPERATION_GROUPS.names)



def request(route, data=None, timeout=2):
    port = os.environ.get('FS_PC_PORT', '')
    token = os.environ.get('FS_PC_TOKEN', '')
    if not port.isdigit() or not token:
        raise RuntimeError('Computer tools require the running FeatherScript desktop app.')
    payload = None if data is None else json.dumps(data).encode('utf-8')
    req = urllib.request.Request(f'http://127.0.0.1:{int(port)}{route}', data=payload,
        headers={'X-FS-PC-Token': token, 'Content-Type': 'application/json'})
    # Loopback requests must never be sent through a system HTTP proxy.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(req, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        try:
            detail = json.load(error).get('error', 'Computer request failed.')
        except (ValueError, AttributeError):
            detail = 'Computer request failed.'
        raise RuntimeError(detail) from None


def tool_defs():
    return TOOLS if status()['state'] == 'working' else []


def _verdict():
    """Why the PC commands are or are not there, in one honest verdict.
    tool_defs() used to answer only with a count, so three completely different
    situations all looked identical to the UI and the model: the desktop app is
    not running at all, the app is running with Computer access switched off, and
    the app is running but its broker stopped answering. Each has a different
    fix, and only the first one is a restart."""
    if not os.environ.get('FS_PC_PORT', '').isdigit() or not os.environ.get('FS_PC_TOKEN'):
        return {'state': 'disabled', 'tools': 0, 'lastError': None,
                'fix': 'The FeatherScript desktop app is not running - it hands the bridge the PC port and token when it launches it, so no PC command can reach this machine until it is open.'}
    try:
        enabled = request('/status').get('enabled') is True
    except Exception as error:
        return {'state': 'failed', 'tools': 0, 'lastError': str(error) or type(error).__name__,
                'fix': 'The desktop app launched this bridge but its PC broker did not answer - open the app and switch Computer access on; if it stays red, restart the app.'}
    if not enabled:
        return {'state': 'disabled', 'tools': 0, 'lastError': None,
                'fix': 'Computer access is switched off in the FeatherScript app - turn it on and approve this extension before any PC command can run.'}
    return {'state': 'working', 'tools': len(TOOLS), 'lastError': None, 'fix': None}


def status():
    """Cached verdict, on the same 2s budget tool_defs() already used, so a
    status refresh costs at most one loopback request."""
    global _verdict_cache
    now = time.monotonic()
    if now - _verdict_cache[0] > 2:
        _verdict_cache = (now, _verdict())
    return _verdict_cache[1]


def call(name, arguments, timeout=120):
    if name == _OPERATION_GROUPS.help_name:
        return {'text': json.dumps(_OPERATION_GROUPS.describe(arguments), ensure_ascii=False), 'images': []}
    if name in _OPERATION_GROUPS.routes:
        name, arguments = _OPERATION_GROUPS.resolve(name, arguments)
    # Resolve before crossing into the broker, so it authorizes the real action,
    # paths and access class rather than trusting a broad group permission.
    result = request('/call', {'tool': name, 'arguments': arguments, 'origin': CLIENT_ORIGIN.get()}, timeout=max(1, min(timeout, 145)))
    if not result.get('ok'):
        raise RuntimeError(result.get('error', 'Computer request failed.'))
    return {'text': json.dumps(result['result'], ensure_ascii=False), 'images': []}
