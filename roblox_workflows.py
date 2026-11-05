"""Bounded Roblox inspection, audit, batch and construction workflows.

All code is fixed locally; user input is serialized as data by feather_tools.
Audits report review candidates, not a promise that a game has zero bugs.
"""
from __future__ import annotations
import math

DEFINITIONS = []
STRING = {'type': 'string', 'minLength': 1, 'maxLength': 2048}
BOOL = {'type': 'boolean'}
VEC = {'type': 'array', 'items': {'type': 'number'}, 'minItems': 3, 'maxItems': 3}
COLOR = {'type': 'string', 'pattern': '^#[0-9a-fA-F]{6}$'}
NUMBER = lambda low, high: {'type': 'number', 'minimum': low, 'maximum': high}
INTEGER = lambda low, high: {'type': 'integer', 'minimum': low, 'maximum': high}
ENUM = lambda *values: {'type': 'string', 'enum': list(values)}
HELPERS = r'''
local function __nodes(root)
 local out={root};local index=1
 while index<=#out and #out<20000 do
  local children=out[index]:GetChildren()
  for _,child in ipairs(children) do if #out>=20000 then break end; table.insert(out,child) end
  index=index+1
 end
 return out
end
local function __props(i,keys)
 local row={path=__path(i),class=i.ClassName}
 for _,key in ipairs(keys) do local ok,v=pcall(function() return i[key] end);if ok then row[key]=__val(v) end end
 return row
end
local function __vector(v) return Vector3.new(v[1],v[2],v[3]) end
local function __enum(group,key) local e=group[key];assert(e,'Unknown enum value: '..key);return e end
'''


def define(name, description, properties, body, defaults=None, required=()):
    DEFINITIONS.append({'name': 'rbx_' + name, 'description': description,
        'properties': {**properties, 'datamodel': ENUM('Edit','Server','Client')}, 'body': HELPERS + body,
        'defaults': {'datamodel':'Edit', **(defaults or {})}, 'required': list(required)})


def inspect(name, classes, fields, extra=''):
    checks = ' or '.join('i:IsA("' + c + '")' for c in classes)
    keys = '{' + ','.join('"' + p + '"' for p in fields.split()) + '}'
    define(name, 'Inspect ' + name.removeprefix('get_').replace('_', ' ') + '. Reads only; scans at most 20,000 instances and returns a bounded list.',
        {'root': STRING, 'limit': INTEGER(1, 500)},
        'local nodes=__nodes(__find({{root}}));local out={};local matched=0\n'
        'for _,i in ipairs(nodes) do if ' + checks + ' then matched=matched+1;if #out<{{limit}} then local row=__props(i,' + keys + ');' + (extra + ';' if extra else '') + 'table.insert(out,row) end end end\n'
        'return {items=out,matched=matched,scanned=#nodes,truncated=matched>#out or #nodes>=20000}',
        {'root': 'game', 'limit': 100})

# 29 inventories, each with class-specific fields rather than generic aliases.
for name, classes, fields in [
 ('script_inventory',['LuaSourceContainer'],'Name'),
 ('remote_inventory',['RemoteEvent','RemoteFunction','UnreliableRemoteEvent'],'Name'),
 ('gui_inventory',['LayerCollector'],'Enabled ResetOnSpawn DisplayOrder'),
 ('audio_inventory',['Sound'],'SoundId Volume Looped Playing PlaybackSpeed SoundGroup'),
 ('animation_inventory',['Animation'],'AnimationId'),
 ('constraints',['Constraint'],'Enabled Attachment0 Attachment1 Visible'),
 ('joints',['JointInstance','WeldConstraint'],'Part0 Part1 Enabled'),
 ('particle_emitters',['ParticleEmitter'],'Enabled Texture Rate Lifetime Speed LightEmission'),
 ('beams',['Beam'],'Enabled Attachment0 Attachment1 Width0 Width1 Texture'),
 ('trails',['Trail'],'Enabled Attachment0 Attachment1 Lifetime Texture'),
 ('lights',['Light'],'Enabled Brightness Color Shadows Range Angle Face'),
 ('spawns',['SpawnLocation'],'Enabled Neutral TeamColor AllowTeamChangeOnTouch Duration'),
 ('prompts',['ProximityPrompt'],'Enabled ActionText ObjectText HoldDuration MaxActivationDistance RequiresLineOfSight'),
 ('click_detectors',['ClickDetector'],'MaxActivationDistance CursorIcon'),
 ('model_pivots',['Model'],'PrimaryPart WorldPivot ModelStreamingMode'),
 ('gui_text',['TextLabel','TextButton','TextBox'],'Text FontFace TextSize TextColor3 TextWrapped RichText'),
 ('gui_images',['ImageLabel','ImageButton'],'Image ImageColor3 ImageTransparency ScaleType'),
 ('mesh_assets',['MeshPart','SpecialMesh'],'MeshId TextureID TextureId'),
 ('decals',['Decal'],'Texture Face Color3 Transparency'),
 ('textures',['Texture'],'Texture StudsPerTileU StudsPerTileV OffsetStudsU OffsetStudsV'),
 ('sound_groups',['SoundGroup'],'Volume'),
 ('teams',['Team'],'TeamColor AutoAssignable'),
 ('attachment_positions',['Attachment'],'Position WorldPosition Orientation WorldOrientation'),
 ('humanoids',['Humanoid'],'Health MaxHealth WalkSpeed JumpPower JumpHeight UseJumpPower RigType'),
 ('attachments',['Attachment'],'Axis SecondaryAxis Visible'),
 ('physics_summary',['BasePart'],'Anchored CanCollide CanTouch CanQuery Massless CollisionGroup AssemblyMass'),
 ('lighting_settings',['Lighting'],'Ambient OutdoorAmbient Brightness ClockTime FogStart FogEnd FogColor ExposureCompensation'),
 ('camera_state',['Camera'],'CameraType CFrame Focus FieldOfView ViewportSize CameraSubject'),
 ('terrain_settings',['Terrain'],'WaterColor WaterTransparency WaterReflectance WaterWaveSize WaterWaveSpeed Decoration'),
]:
    inspect('get_' + name, classes, fields)

# Six richer read workflows bring the read category to 35.
define('get_scene_summary','Count classes and top-level roots; bounded to 20,000 instances.',{'root':STRING},r'''
local root=__find({{root}});local nodes=__nodes(root);local classes={};for _,i in ipairs(nodes) do classes[i.ClassName]=(classes[i.ClassName] or 0)+1 end
return {root=__path(root),instances=#nodes,classes=classes,truncated=#nodes>=20000}
''',{'root':'game.Workspace'})
define('get_collision_groups','Read registered collision groups and their collision matrix.',{},r'''
local service=game:GetService('PhysicsService');local groups=service:GetRegisteredCollisionGroups();assert(#groups<=64,'Too many groups');local rows={}
for _,g in ipairs(groups) do local name=g.name or g.Name;local collides={};for _,other in ipairs(groups) do local n=other.name or other.Name;collides[n]=service:CollisionGroupsAreCollidable(name,n) end;table.insert(rows,{name=name,collides=collides}) end
return rows
''')
define('get_network_ownership','Inspect part network owners in the chosen running datamodel; unavailable owners are reported per item.',{'root':STRING,'limit':INTEGER(1,500)},r'''
local out={};for _,i in ipairs(__nodes(__find({{root}}))) do if i:IsA('BasePart') and #out<{{limit}} then
 local ok,value=pcall(function() local p=i:GetNetworkOwner();return p and p.Name or 'server' end);table.insert(out,{path=__path(i),owner=ok and value or nil,error=not ok and tostring(value) or nil}) end end
return out
''',{'root':'game.Workspace','limit':100})
define('get_attributes_index','Find attribute names and their instance values, bounded to the requested result limit.',{'root':STRING,'limit':INTEGER(1,500)},r'''
local out={};local nodes=__nodes(__find({{root}}));local matched=0
for _,i in ipairs(nodes) do local a=i:GetAttributes();if next(a) then matched=matched+1;if #out<{{limit}} then table.insert(out,{path=__path(i),attributes=__val(a)}) end end end
return {items=out,matched=matched,truncated=matched>#out or #nodes>=20000}
''',{'root':'game','limit':100})
define('get_tag_inventory','Read CollectionService tag counts and bounded instance paths.',{'limit':INTEGER(1,500)},r'''
local service=game:GetService('CollectionService');local out={};local tags=service:GetAllTags();table.sort(tags)
for _,tag in ipairs(tags) do if #out<{{limit}} then local tagged=service:GetTagged(tag);local paths={};for n=1,math.min(#tagged,100) do paths[n]=__path(tagged[n]) end;table.insert(out,{tag=tag,count=#tagged,paths=paths,truncated=#tagged>100}) end end
return {items=out,truncated=#tags>#out}
''',{'limit':100})
define('get_workspace_settings','Read global gravity, streaming and simulation settings without changing them.',{},r'''
return __props(workspace,{'Gravity','FallenPartsDestroyHeight','StreamingEnabled','StreamingMinRadius','StreamingTargetRadius','GlobalWind'})
''')

AUDITS = [
 ('unanchored_parts',"i:IsA('BasePart') and not i.Anchored",'Unanchored part; check whether simulation is intended.'),
 ('collidable_decoration',"i:IsA('BasePart') and i.CanCollide and i.Transparency>=0.95",'Nearly invisible collidable part; may be an intentional hitbox.'),
 ('orphan_attachments',"i:IsA('Attachment') and not (i.Parent and (i.Parent:IsA('BasePart') or i.Parent:IsA('Bone')))",'Attachment is outside a part/bone.'),
 ('broken_constraints',"i:IsA('Constraint') and (not i.Attachment0 or not i.Attachment1)",'Constraint missing an attachment; one-attachment modes may be intentional.'),
 ('empty_scripts',"i:IsA('LuaSourceContainer') and __source(i):match('^%s*$')~=nil",'Script has no readable source text.'),
 ('duplicate_names',"i.Parent and __duplicate(i)",'Sibling has the same name; path lookup may be ambiguous.'),
 ('disabled_scripts',"i:IsA('BaseScript') and i.Disabled",'Script is disabled; check intended startup behavior.'),
 ('remote_locations',"(i:IsA('RemoteEvent') or i:IsA('RemoteFunction') or i:IsA('UnreliableRemoteEvent')) and not i:IsDescendantOf(game:GetService('ReplicatedStorage')) and not i:IsDescendantOf(workspace)",'Remote is outside common replicated locations; verify intended visibility.'),
 ('deprecated_movers',"i:IsA('BodyMover')",'Legacy BodyMover; review modern constraints before migrating.'),
 ('missing_primary_parts',"i:IsA('Model') and not i.PrimaryPart",'No PrimaryPart; valid for pivot-based models but required by some scripts.'),
 ('ui_overflow',"i:IsA('GuiObject') and __overflow(i)",'GUI extends beyond its parent bounds; may be intentional.'),
 ('duplicate_assets',"__duplicate_asset(i)",'Repeated asset reference; review reuse before changing anything.'),
 ('missing_sound_ids',"i:IsA('Sound') and i.SoundId==''",'Sound has no SoundId.'),
 ('empty_models',"i:IsA('Model') and #i:GetChildren()==0",'Empty model.'),
 ('script_risks',"i:IsA('LuaSourceContainer') and __risky_source(i)",'Heuristic match for dynamic require/loadstring or an unbounded loop; review source, not proof of a bug.'),
 ('zero_size_parts',"i:IsA('BasePart') and (i.Size.X<0.05 or i.Size.Y<0.05 or i.Size.Z<0.05)",'Part is degenerate on at least one axis; may be an intentional thin surface.'),
 ('empty_text_labels',"i:IsA('TextLabel') and i.Text:match('^%s*$')~=nil",'Visible text label has no text; check whether it needs copy or should be hidden.'),
 ('invisible_buttons',"(i:IsA('TextButton') and i.BackgroundTransparency>=1 and i.TextTransparency>=1) or (i:IsA('ImageButton') and i.BackgroundTransparency>=1 and i.ImageTransparency>=1)",'Button renders nothing but can still receive input; confirm the hitbox is deliberate.'),
 ('orphan_effects',"(i:IsA('ParticleEmitter') or i:IsA('Beam') or i:IsA('Trail')) and not (i.Parent and (i.Parent:IsA('BasePart') or i.Parent:IsA('Attachment')))",'Effect is outside a part/attachment and may never render.'),
]
AUDIT_HELPERS = r'''
local __sourceBytes,__unreadable,__sourceTruncated=0,0,false
local function __source(i) if __sourceBytes>=2097152 then __sourceTruncated=true;return '<truncated>' end;local ok,s=pcall(function() return i.Source end);if not ok then __unreadable=__unreadable+1;return '<unreadable>' end;if #s>16384 then __sourceTruncated=true end;local sample=string.sub(s,1,16384);__sourceBytes=__sourceBytes+#sample;return sample end
local __names={}
local function __duplicate(i) local counts=__names[i.Parent];if not counts then counts={};for _,c in ipairs(i.Parent:GetChildren()) do counts[c.Name]=(counts[c.Name] or 0)+1 end;__names[i.Parent]=counts end;return (counts[i.Name] or 0)>1 end
local function __overflow(i) local p=i.Parent;if not p or not p:IsA('GuiObject') then return false end;local a,b,c,d=i.AbsolutePosition,i.AbsoluteSize,p.AbsolutePosition,p.AbsoluteSize;return a.X<c.X-1 or a.Y<c.Y-1 or a.X+b.X>c.X+d.X+1 or a.Y+b.Y>c.Y+d.Y+1 end
local __assets={}
local function __duplicate_asset(i) local id=nil;if i:IsA('Sound') then id=i.SoundId elseif i:IsA('Animation') then id=i.AnimationId elseif i:IsA('Decal') then id=i.Texture elseif i:IsA('ImageLabel') or i:IsA('ImageButton') then id=i.Image end;if not id or id=='' then return false end;local old=__assets[id];__assets[id]=true;return old==true end
local function __risky_source(i) local s=__source(i);return s:find('loadstring%s*%(')~=nil or s:find('require%s*%(%s*%d')~=nil or (s:find('while%s+true%s+do')~=nil and not s:find('wait%s*%(')) end
'''
for name,predicate,note in AUDITS:
    define('audit_'+name,'Read-only review: '+note+' Scans at most 20,000 instances; findings are candidates, not definitive bugs.',{'root':STRING,'limit':INTEGER(1,500)},AUDIT_HELPERS+r'''
local nodes=__nodes(__find({{root}}));local out={};local matched=0
for _,i in ipairs(nodes) do if '''+predicate+''' then matched=matched+1;if #out<{{limit}} then table.insert(out,{path=__path(i),class=i.ClassName,note='''+repr(note)+'''}) end end end
return {findings=out,matched=matched,scanned=#nodes,truncated=matched>#out or #nodes>=20000,heuristic=true,unreadableScripts=__unreadable,sourceTruncated=__sourceTruncated}
''',{'root':'game','limit':100})


def batch(name,description,kind,properties,code,defaults=None,required=()):
    props={'paths':{'type':'array','items':STRING,'minItems':1,'maxItems':80},**properties}
    check='i:IsA("'+kind+'")' if kind else 'true'
    define('batch_'+name,description+' Validates all paths/classes before editing up to 80 targets; returns per-item failures.',props,r'''
local targets={};for _,p in ipairs({{paths}}) do local i=__find(p);assert('''+check+''','Wrong instance class at '..p);table.insert(targets,i) end
local out={};local failed=0
for _,i in ipairs(targets) do local ok,err=pcall(function() '''+code+''' end);if not ok then failed=failed+1 end;table.insert(out,{path=__path(i),ok=ok,error=not ok and tostring(err) or nil}) end
return {results=out,failed=failed,partial=failed>0 and failed<#out}
''',defaults,('paths',*required))

batch('set_collision','Set part collision, touch and query flags.','BasePart',{'collide':BOOL,'touch':BOOL,'query':BOOL},'i.CanCollide={{collide}};i.CanTouch={{touch}};i.CanQuery={{query}}',{'touch':True,'query':True},('collide',))
batch('set_material','Set the material of selected parts.','BasePart',{'material':STRING},'i.Material=__enum(Enum.Material,{{material}})',required=('material',))
batch('set_color','Set part RGB color from #RRGGBB.','BasePart',{'color':COLOR},'i.Color=Color3.fromHex({{color}})',required=('color',))
batch('set_transparency','Set part transparency.','BasePart',{'value':NUMBER(0,1)},'i.Transparency={{value}}',required=('value',))
batch('set_shadows','Enable or disable part shadow casting.','BasePart',{'enabled':BOOL},'i.CastShadow={{enabled}}',required=('enabled',))
batch('set_massless','Set massless behavior on parts.','BasePart',{'enabled':BOOL},'i.Massless={{enabled}}',required=('enabled',))
batch('set_locked','Set Studio selection locks on parts.','BasePart',{'enabled':BOOL},'i.Locked={{enabled}}',required=('enabled',))
batch('set_collision_group','Assign parts to an existing collision group.','BasePart',{'group':STRING},'i.CollisionGroup={{group}}',required=('group',))
batch('scale_models','Scale models relative to their current model scale.','Model',{'factor':NUMBER(.01,100)},'i:ScaleTo(i:GetScale()*{{factor}})',required=('factor',))
batch('pivot_offset','Offset model/part pivots by a world-space vector.','PVInstance',{'offset':VEC},'i:PivotTo(i:GetPivot()+__vector({{offset}}))',required=('offset',))
batch('name_prefix','Add a name prefix to specific instances.',None,{'prefix':STRING},'i.Name={{prefix}}..i.Name',required=('prefix',))
batch('name_suffix','Add a name suffix to specific instances.',None,{'suffix':STRING},'i.Name=i.Name..{{suffix}}',required=('suffix',))
batch('set_archivable','Set whether instances can be cloned/saved.',None,{'enabled':BOOL},'i.Archivable={{enabled}}',required=('enabled',))
batch('set_streaming_mode','Set a model streaming mode.','Model',{'mode':ENUM('Default','Atomic','Persistent','PersistentPerPlayer')},'i.ModelStreamingMode=__enum(Enum.ModelStreamingMode,{{mode}})',required=('mode',))
batch('set_attribute','Set one scalar attribute across explicit targets.',None,{'attribute':STRING,'value':{'type':['string','number','boolean']}},'i:SetAttribute({{attribute}},{{value}})',required=('attribute','value'))
batch('remove_attribute','Remove one named attribute across explicit targets.',None,{'attribute':STRING},'i:SetAttribute({{attribute}},nil)',required=('attribute',))
batch('add_tag','Apply a CollectionService tag to explicit targets.',None,{'tag':STRING},"game:GetService('CollectionService'):AddTag(i,{{tag}})",required=('tag',))
batch('remove_tag','Remove a CollectionService tag from explicit targets.',None,{'tag':STRING},"game:GetService('CollectionService'):RemoveTag(i,{{tag}})",required=('tag',))
batch('disable_scripts','Enable/disable BaseScript execution for explicit targets.','BaseScript',{'disabled':BOOL},'i.Disabled={{disabled}}',required=('disabled',))
batch('enable_effects','Set Enabled on selected effects/emitters/lights.',None,{'enabled':BOOL},"assert(i:IsA('ParticleEmitter') or i:IsA('Beam') or i:IsA('Trail') or i:IsA('Light'),'Not an enabled effect');i.Enabled={{enabled}}",required=('enabled',))
batch('set_size','Set the absolute size of selected parts or GUI objects.',None,{'size':VEC},"assert(i:IsA('BasePart') or i:IsA('GuiObject'),'Not a part or GUI object');if i:IsA('BasePart') then i.Size=__vector({{size}}) else i.Size=UDim2.fromOffset(({{size}})[1],({{size}})[2]) end",required=('size',))
batch('set_orientation','Set the orientation in degrees of selected parts.','BasePart',{'orientation':VEC},'i.Orientation=__vector({{orientation}})',required=('orientation',))
batch('set_reflectance','Set reflectance on parts and GUI objects.',None,{'value':NUMBER(0,1)},'i.Reflectance={{value}}',required=('value',))
batch('set_text','Set the Text property on selected UI text elements.',None,{'text':{'type':'string','maxLength':10000}},"assert(i:IsA('TextLabel') or i:IsA('TextButton') or i:IsA('TextBox'),'Not a text element');i.Text={{text}}",required=('text',))
batch('set_text_size','Set TextSize on selected UI text elements.',None,{'size':INTEGER(1,100)},"assert(i:IsA('TextLabel') or i:IsA('TextButton') or i:IsA('TextBox'),'Not a text element');i.TextSize={{size}}",required=('size',))
batch('set_text_color','Set TextColor3 from #RRGGBB on selected UI text elements.',None,{'color':COLOR},"assert(i:IsA('TextLabel') or i:IsA('TextButton') or i:IsA('TextBox'),'Not a text element');i.TextColor3=Color3.fromHex({{color}})",required=('color',))
batch('set_visible','Set the Visible property on selected GUI objects.','GuiObject',{'visible':BOOL},'i.Visible={{visible}}',required=('visible',))
batch('set_zindex','Set the ZIndex of selected GUI objects.','GuiObject',{'index':INTEGER(-10000,10000)},'i.ZIndex={{index}}',required=('index',))
batch('set_image','Set the Image asset on selected image UI elements.',None,{'asset':STRING},"assert(i:IsA('ImageLabel') or i:IsA('ImageButton'),'Not an image element');i.Image={{asset}}",required=('asset',))
batch('set_layout_order','Set the LayoutOrder of selected instances that support it.',None,{'order':INTEGER(-10000,10000)},'i.LayoutOrder={{order}}',required=('order',))


def create(name,cls,description,properties,code,defaults=None,required=(),parent='game.Workspace'):
    base={'parent':STRING,'name':{'type':'string','minLength':1,'maxLength':100},**properties}
    define('create_'+name,description+' Refuses an existing sibling name; incomplete construction is cleaned up.',base,r'''
local parent=__find({{parent}});assert(not parent:FindFirstChild({{name}}),'Sibling name already exists')
local i=Instance.new('''+repr(cls)+''');local ok,err=pcall(function() i.Name={{name}};'''+code+''';i.Parent=parent end)
if not ok then i:Destroy();error(err) end;return {path=__path(i),class=i.ClassName}
''',{'parent':parent,'name':cls,**(defaults or {})},required)

create('spawn','SpawnLocation','Create an anchored, neutral spawn pad.',{'position':VEC,'size':VEC},'i.Anchored=true;i.Neutral=true;i.Position=__vector({{position}});i.Size=__vector({{size}})',{'position':[0,3,0],'size':[6,1,6]})
create('checkpoint','SpawnLocation','Create a checkpoint spawn with an index attribute; does not install game logic.',{'position':VEC,'index':INTEGER(1,10000)},"i.Anchored=true;i.Neutral=true;i.Position=__vector({{position}});i:SetAttribute('CheckpointIndex',{{index}})",{'position':[0,3,0]},('index',))
create('proximity_prompt','ProximityPrompt','Create a proximity interaction prompt; connect gameplay handlers separately.',{'action':STRING,'object':STRING,'hold':NUMBER(0,30),'distance':NUMBER(1,100)},'i.ActionText={{action}};i.ObjectText={{object}};i.HoldDuration={{hold}};i.MaxActivationDistance={{distance}}',{'action':'Interact','object':'Object','hold':0,'distance':10},('parent',))
create('click_detector','ClickDetector','Create a click interaction detector.',{'distance':NUMBER(1,1000)},'i.MaxActivationDistance={{distance}}',{'distance':32},('parent',))
create('attachment','Attachment','Create an attachment with a local-space position.',{'position':VEC},'i.Position=__vector({{position}})',{'position':[0,0,0]},('parent',))
create('weld_constraint','WeldConstraint','Weld two existing BaseParts.',{'part0':STRING,'part1':STRING},"i.Part0=__find({{part0}});i.Part1=__find({{part1}})",required=('part0','part1'))
for name,cls,params,code,defaults in [
 ('rope_constraint','RopeConstraint',{'length':NUMBER(.01,10000)},'i.Length={{length}}',{'length':10}),
 ('spring_constraint','SpringConstraint',{'length':NUMBER(0,10000),'stiffness':NUMBER(0,1000000),'damping':NUMBER(0,1000000)},'i.FreeLength={{length}};i.Stiffness={{stiffness}};i.Damping={{damping}}',{'length':5,'stiffness':100,'damping':10}),
 ('hinge_constraint','HingeConstraint',{'lower':NUMBER(-180,180),'upper':NUMBER(-180,180)},'i.LimitsEnabled=true;i.LowerAngle={{lower}};i.UpperAngle={{upper}}',{'lower':-90,'upper':90}),
 ('align_position','AlignPosition',{'force':NUMBER(0,1000000000),'responsiveness':NUMBER(5,200)},'i.MaxForce={{force}};i.Responsiveness={{responsiveness}}',{'force':10000,'responsiveness':20}),
 ('align_orientation','AlignOrientation',{'torque':NUMBER(0,1000000000),'responsiveness':NUMBER(5,200)},'i.MaxTorque={{torque}};i.Responsiveness={{responsiveness}}',{'torque':10000,'responsiveness':20}),
]:
    create(name,cls,'Connect two existing attachments with a '+cls+'.',{'attachment0':STRING,'attachment1':STRING,**params},'i.Attachment0=__find({{attachment0}});i.Attachment1=__find({{attachment1}});'+code,defaults,('attachment0','attachment1'))
define('create_collision_group','Register a named collision group, refusing an existing name.',{'name':{'type':'string','minLength':1,'maxLength':100}},r'''
local service=game:GetService('PhysicsService');assert(not service:IsCollisionGroupRegistered({{name}}),'Collision group already exists');service:RegisterCollisionGroup({{name}});return {created={{name}}}
''',required=('name',))
for name,cls,extra,code,defaults in [
 ('point_light','PointLight',{},'',{}),
 ('spot_light','SpotLight',{'angle':NUMBER(0,180)},'i.Angle={{angle}};',{'angle':90}),
 ('surface_light','SurfaceLight',{'face':ENUM('Top','Bottom','Left','Right','Front','Back')},'i.Face=__enum(Enum.NormalId,{{face}});',{'face':'Front'}),
]:
    create(name,cls,'Create a configured '+cls+'.',{'brightness':NUMBER(0,100),'range':NUMBER(0,60),'color':COLOR,**extra},code+'i.Brightness={{brightness}};i.Range={{range}};i.Color=Color3.fromHex({{color}})',{'brightness':2,'range':16,'color':'#ffffff',**defaults},('parent',))
create('sound','Sound','Create a configured sound without automatically playing it.',{'asset':STRING,'volume':NUMBER(0,10),'looped':BOOL},'i.SoundId={{asset}};i.Volume={{volume}};i.Looped={{looped}}',{'volume':.5,'looped':False},('asset',))
create('particle_emitter','ParticleEmitter','Create a configured emitter, initially disabled for explicit activation.',{'texture':STRING,'rate':NUMBER(0,10000),'lifetime':NUMBER(.01,60),'speed':NUMBER(0,1000)},'i.Texture={{texture}};i.Rate={{rate}};i.Lifetime=NumberRange.new({{lifetime}});i.Speed=NumberRange.new({{speed}});i.Enabled=false',{'rate':20,'lifetime':1,'speed':5},('parent','texture'))
create('beam','Beam','Create a beam connecting two attachments.',{'attachment0':STRING,'attachment1':STRING,'width':NUMBER(0,100),'color':COLOR},'i.Attachment0=__find({{attachment0}});i.Attachment1=__find({{attachment1}});i.Width0={{width}};i.Width1={{width}};i.Color=ColorSequence.new(Color3.fromHex({{color}}))',{'width':.2,'color':'#ffffff'},('attachment0','attachment1'))
create('trail','Trail','Create a trail connecting two attachments.',{'attachment0':STRING,'attachment1':STRING,'lifetime':NUMBER(.01,20),'color':COLOR},'i.Attachment0=__find({{attachment0}});i.Attachment1=__find({{attachment1}});i.Lifetime={{lifetime}};i.Color=ColorSequence.new(Color3.fromHex({{color}}))',{'lifetime':.5,'color':'#ffffff'},('attachment0','attachment1'))
create('highlight','Highlight','Create an outline/fill highlight for an existing adornee.',{'adornee':STRING,'fill':COLOR,'outline':COLOR},'i.Adornee=__find({{adornee}});i.FillColor=Color3.fromHex({{fill}});i.OutlineColor=Color3.fromHex({{outline}})',{'fill':'#38bdf8','outline':'#ffffff'},('adornee',))
create('screen_gui','ScreenGui','Create a persistent UI root in StarterGui.',{'resetOnSpawn':BOOL,'displayOrder':INTEGER(-1000,1000)},'i.ResetOnSpawn={{resetOnSpawn}};i.DisplayOrder={{displayOrder}}',{'resetOnSpawn':False,'displayOrder':0},parent='game.StarterGui')
for name,cls in [('text_label','TextLabel'),('text_button','TextButton')]:
    create(name,cls,'Create a text UI element with offset sizing.',{'text':{'type':'string','maxLength':10000},'width':INTEGER(1,4096),'height':INTEGER(1,4096),'textSize':INTEGER(1,100),'color':COLOR},'i.Text={{text}};i.Size=UDim2.fromOffset({{width}},{{height}});i.TextSize={{textSize}};i.TextColor3=Color3.fromHex({{color}});i.BackgroundTransparency=1',{'text':'Label','width':200,'height':40,'textSize':18,'color':'#ffffff'},('parent',))
create('image_label','ImageLabel','Create an image UI element with offset sizing.',{'asset':STRING,'width':INTEGER(1,4096),'height':INTEGER(1,4096)},'i.Image={{asset}};i.Size=UDim2.fromOffset({{width}},{{height}});i.BackgroundTransparency=1',{'width':100,'height':100},('parent','asset'))
create('ui_list_layout','UIListLayout','Create a sorted UI list layout.',{'padding':INTEGER(0,256),'direction':ENUM('Horizontal','Vertical')},'i.Padding=UDim.new(0,{{padding}});i.FillDirection=__enum(Enum.FillDirection,{{direction}});i.SortOrder=Enum.SortOrder.LayoutOrder',{'padding':8,'direction':'Vertical'},('parent',))
create('ui_grid_layout','UIGridLayout','Create a UI grid layout with pixel cells and gaps.',{'cellWidth':INTEGER(1,1024),'cellHeight':INTEGER(1,1024),'padding':INTEGER(0,256)},'i.CellSize=UDim2.fromOffset({{cellWidth}},{{cellHeight}});i.CellPadding=UDim2.fromOffset({{padding}},{{padding}});i.SortOrder=Enum.SortOrder.LayoutOrder',{'cellWidth':100,'cellHeight':100,'padding':8},('parent',))
create('ui_corner','UICorner','Round an existing GUI element.',{'radius':INTEGER(0,1024)},'i.CornerRadius=UDim.new(0,{{radius}})',{'radius':12},('parent',))
create('ui_stroke','UIStroke','Outline an existing GUI element.',{'color':COLOR,'thickness':NUMBER(0,100),'transparency':NUMBER(0,1)},'i.Color=Color3.fromHex({{color}});i.Thickness={{thickness}};i.Transparency={{transparency}}',{'color':'#ffffff','thickness':1,'transparency':0},('parent',))
create('text_box','TextBox','Create a text input with offset sizing.',{'text':{'type':'string','maxLength':10000},'placeholder':{'type':'string','maxLength':1000},'width':INTEGER(1,4096),'height':INTEGER(1,4096),'textSize':INTEGER(1,100),'color':COLOR},'i.Text={{text}};i.PlaceholderText={{placeholder}};i.Size=UDim2.fromOffset({{width}},{{height}});i.TextSize={{textSize}};i.TextColor3=Color3.fromHex({{color}});i.BackgroundTransparency=1',{'text':'','placeholder':'Type here','width':240,'height':40,'textSize':18,'color':'#ffffff'},('parent',))
create('frame','Frame','Create a background panel with offset sizing.',{'width':INTEGER(1,4096),'height':INTEGER(1,4096),'color':COLOR,'transparency':NUMBER(0,1)},'i.Size=UDim2.fromOffset({{width}},{{height}});i.BackgroundColor3=Color3.fromHex({{color}});i.BackgroundTransparency={{transparency}}',{'width':320,'height':180,'color':'#101014','transparency':0},('parent',))
create('scrolling_frame','ScrollingFrame','Create a scrolling panel with a bounded canvas.',{'width':INTEGER(1,4096),'height':INTEGER(1,4096),'canvasWidth':INTEGER(1,20000),'canvasHeight':INTEGER(1,20000)},'i.Size=UDim2.fromOffset({{width}},{{height}});i.CanvasSize=UDim2.fromOffset({{canvasWidth}},{{canvasHeight}});i.ScrollBarThickness=6',{'width':320,'height':240,'canvasWidth':320,'canvasHeight':800},('parent',))
create('canvas_group','CanvasGroup','Create a group that renders its children to a texture.',{'width':INTEGER(1,4096),'height':INTEGER(1,4096),'groupTransparency':NUMBER(0,1)},'i.Size=UDim2.fromOffset({{width}},{{height}});i.GroupTransparency={{groupTransparency}}',{'width':320,'height':180,'groupTransparency':0},('parent',))
create('image_button','ImageButton','Create a clickable image with offset sizing.',{'asset':STRING,'width':INTEGER(1,4096),'height':INTEGER(1,4096)},'i.Image={{asset}};i.Size=UDim2.fromOffset({{width}},{{height}});i.BackgroundTransparency=1',{'width':64,'height':64},('parent','asset'))
create('viewport_frame','ViewportFrame','Create a 3D preview viewport.',{'width':INTEGER(1,4096),'height':INTEGER(1,4096)},'i.Size=UDim2.fromOffset({{width}},{{height}});i.BackgroundColor3=Color3.fromHex("#101014")',{'width':200,'height':200},('parent',))
create('ui_padding','UIPadding','Add padding to an existing GUI element.',{'padding':INTEGER(0,1024)},'i.PaddingTop=UDim.new(0,{{padding}});i.PaddingBottom=UDim.new(0,{{padding}});i.PaddingLeft=UDim.new(0,{{padding}});i.PaddingRight=UDim.new(0,{{padding}})',{'padding':8},('parent',))
create('ui_aspect','UIAspectRatioConstraint','Constrain a GUI element to an aspect ratio.',{'ratio':NUMBER(.01,100)},'i.AspectRatio={{ratio}}',{'ratio':1},('parent',))
create('ui_size_constraint','UISizeConstraint','Bound the size of a GUI element in pixels.',{'minWidth':INTEGER(1,4096),'minHeight':INTEGER(1,4096),'maxWidth':INTEGER(1,4096),'maxHeight':INTEGER(1,4096)},'i.MinSize=Vector2.new({{minWidth}},{{minHeight}});i.MaxSize=Vector2.new({{maxWidth}},{{maxHeight}})',{'minWidth':1,'minHeight':1,'maxWidth':4096,'maxHeight':4096},('parent',))
create('part_block','Part','Create an anchored block part.',{'position':VEC,'size':VEC,'color':COLOR,'anchored':BOOL},'i.Anchored={{anchored}};i.Position=__vector({{position}});i.Size=__vector({{size}});i.Color=Color3.fromHex({{color}})',{'position':[0,3,0],'size':[4,1,4],'color':'#a3a3ad','anchored':True},('position',))
create('wedge_part','WedgePart','Create an anchored wedge part.',{'position':VEC,'size':VEC,'color':COLOR},'i.Anchored=true;i.Position=__vector({{position}});i.Size=__vector({{size}});i.Color=Color3.fromHex({{color}})',{'position':[0,3,0],'size':[4,4,4],'color':'#a3a3ad'},('position',))
create('cylinder_part','Part','Create an anchored cylindrical part using Part.Shape.',{'position':VEC,'size':VEC,'color':COLOR},'i.Shape=Enum.PartType.Cylinder;i.Anchored=true;i.Position=__vector({{position}});i.Size=__vector({{size}});i.Color=Color3.fromHex({{color}})',{'position':[0,3,0],'size':[4,4,4],'color':'#a3a3ad'},('position',))
create('seat','Seat','Create a seat part.',{'position':VEC,'size':VEC},'i.Anchored=true;i.Position=__vector({{position}});i.Size=__vector({{size}})',{'position':[0,3,0],'size':[4,1,4]},('position',))
create('vehicle_seat','VehicleSeat','Create a vehicle seat part.',{'position':VEC,'size':VEC},'i.Anchored=true;i.Position=__vector({{position}});i.Size=__vector({{size}})',{'position':[0,3,0],'size':[4,1,4]},('position',))
create('sound_group','SoundGroup','Create an audio bus for grouping sounds.',{'volume':NUMBER(0,10)},'i.Volume={{volume}}',{'volume':1},parent='game.SoundService')
create('team','Team','Create a Team in Teams.',{'color':COLOR,'autoAssignable':BOOL},'i.TeamColor=BrickColor.new(Color3.fromHex({{color}}));i.AutoAssignable={{autoAssignable}}',{'color':'#8a8a94','autoAssignable':False},parent='game.Teams')
define('set_lighting_preset','Apply one explicit Lighting preset; does not change terrain or insert post effects.',{'preset':ENUM('daylight','dusk','night','studio')},r'''
local settings={daylight={14,2,0.1},dusk={18,1.5,-0.1},night={0,1,0},studio={12,3,0.2}};local value=settings[{{preset}}];assert(value,'Invalid preset');local light=game:GetService('Lighting');light.ClockTime=value[1];light.Brightness=value[2];light.ExposureCompensation=value[3];return __props(light,{'ClockTime','Brightness','ExposureCompensation'})
''',required=('preset',))
define('set_camera_view','Set the current edit camera to a scriptable look-at view; restore its type with set_properties when done.',{'position':VEC,'target':VEC,'fov':NUMBER(1,120)},r'''
local camera=workspace.CurrentCamera;assert(camera,'No current camera');local position,target=__vector({{position}}),__vector({{target}});assert((position-target).Magnitude>0.001,'Camera and target must differ');camera.CameraType=Enum.CameraType.Scriptable;camera.CFrame=CFrame.lookAt(position,target);camera.Focus=CFrame.new(target);camera.FieldOfView={{fov}};return __props(camera,{'CFrame','Focus','FieldOfView','CameraType'})
''',{'fov':70},('position','target'))


def _validate(value, schema, label):
    import re
    types=schema.get('type');types=types if isinstance(types,list) else [types]
    matches={'string':isinstance(value,str),'boolean':isinstance(value,bool),'number':isinstance(value,(int,float)) and not isinstance(value,bool),'integer':isinstance(value,int) and not isinstance(value,bool),'array':isinstance(value,list)}
    if not any(matches.get(kind,False) for kind in types): raise ValueError(label+' has the wrong type')
    if isinstance(value,(int,float)) and not isinstance(value,bool):
        if not math.isfinite(value) or value<schema.get('minimum',-math.inf) or value>schema.get('maximum',math.inf):raise ValueError(label+' is outside its allowed range')
    if isinstance(value,str):
        if len(value)<schema.get('minLength',0) or len(value)>schema.get('maxLength',2048) or '\0' in value:raise ValueError(label+' has an invalid length or NUL')
        if schema.get('pattern') and not re.fullmatch(schema['pattern'],value):raise ValueError(label+' has an invalid format')
    if 'enum' in schema and value not in schema['enum']:raise ValueError(label+' is not an allowed value')
    if isinstance(value,list):
        if not schema.get('minItems',0)<=len(value)<=schema.get('maxItems',100):raise ValueError(label+' has an invalid item count')
        for item in value:_validate(item,schema['items'],label+' item')


def register(register_tool, run_luau, error_type):
    for definition in DEFINITIONS:
        def runner(ctx,args,d=definition):
            merged={**d['defaults'],**args}
            for key in args:
                if key not in d['properties']:raise error_type('Unknown argument: '+key)
            for key in d['required']:
                if key not in args:raise error_type('Missing argument: '+key)
            try:
                for key,value in merged.items():_validate(value,d['properties'][key],key)
            except ValueError as error:raise error_type(str(error)) from None
            return run_luau(ctx,d['body'],**merged)
        register_tool(definition['name'],definition['description'],definition['properties'],definition['required'],run=runner)

assert len(DEFINITIONS)==130, f'Unexpected workflow count: {len(DEFINITIONS)}'
assert len({item['name'] for item in DEFINITIONS})==len(DEFINITIONS)
