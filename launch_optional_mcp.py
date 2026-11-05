"""Launch a curated optional MCP server without shell interpolation."""
import json, os, shutil, subprocess, sys
from pathlib import Path

def find_uvx():
    located=shutil.which('uvx')
    if located:return located
    base=Path(os.environ.get('LOCALAPPDATA',str(Path.home()/'.local/share')))
    managed=base/'FeatherScript/runtime/uv/bin'/('uvx.exe' if os.name=='nt' else 'uvx')
    return str(managed) if managed.is_file() else None

def command(server):
    presets=json.loads(Path(__file__).with_name('mcp-presets.json').read_text())
    spec=next((p for p in presets if p['id']==server),None)
    if not spec: raise ValueError('Unknown optional MCP server')
    if spec['runner']=='npm':
        node=shutil.which('node')
        npx=shutil.which('npx')
        if not node or not npx: raise RuntimeError('Install Node.js with npm to enable this integration, then restart FeatherScript.')
        cli=Path(npx).parent/'node_modules/npm/bin/npx-cli.js'
        if cli.is_file(): return [node,str(cli),'--yes',*spec['args']]
        if os.name!='nt': return [npx,'--yes',*spec['args']]
        raise RuntimeError('npm CLI was not found next to npx. Repair the Node.js installation.')
    uvx=find_uvx()
    if not uvx: raise RuntimeError('Install uv (which includes uvx), then restart FeatherScript before enabling this integration.')
    return [uvx,'--python',sys.executable,*spec['args']]

if __name__=='__main__':
    try:
        argv=command(sys.argv[1])
        env=dict(os.environ)
        if sys.argv[1]=='git':
            git=shutil.which('git')
            if not git:raise RuntimeError('Git was not found. Install Git for Windows, then restart FeatherScript.')
            env['GIT_PYTHON_GIT_EXECUTABLE']=git
        if sys.argv[1]=='memory':
            folder=Path(os.environ.get('LOCALAPPDATA',str(Path.home())))/'FeatherScript'/'mcp-memory'
            folder.mkdir(parents=True,exist_ok=True);env['MEMORY_FILE_PATH']=str(folder/'graph.jsonl')
        raise SystemExit(subprocess.call(argv,env=env))
    except Exception as error:
        print('FeatherScript optional MCP: '+str(error),file=sys.stderr);raise SystemExit(1)
