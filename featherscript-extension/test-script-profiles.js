const assert=require('node:assert/strict');const E=require('./core/task-policy.js');
for(const mode of ['agent','roblox']){for(const tool of ['pc_read_file','pc_write_file','pc_run_program','obsidian_read_note','feather_getskills','list_commands'])assert.equal(E.allowsTool(mode,tool),true);}
for(const tool of ['execute_luau','multi_edit','roblox/execute_luau','start_stop_play','feather_capture','feather_capturevideo','roblox/feather_capture'])assert.equal(E.allowsTool('agent',tool,'roblox'),false);
assert.equal(E.allowsTool('roblox','execute_luau','roblox'),true);assert.equal(E.allowsTool('agent','execute_luau','roblox'),false);assert.equal(E.allowsTool('roblox','blender/generate_3d','blender'),true,'Blender works in RobloxScript mode too');assert.equal(E.scriptMode('invalid'),'roblox');console.log('PASS script profile tool boundaries and shared PC tools');

const skills=[{folder:"ul-luau-code"},{folder:"roblox-ui"},{folder:"pc-files"},{folder:"python",scope:"pc"}];
assert.deepEqual(E.skillsForProfile(skills,"agent").map(skill=>skill.folder),["pc-files","python"]);
assert.equal(E.skillsForProfile(skills,"roblox").length,4);
assert.equal(E.allowsTool("roblox","feather_capture","roblox"),true);
