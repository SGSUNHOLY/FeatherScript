"""Skill context stays scoped, cacheable and discoverable without eager references."""
from pathlib import Path
import os,tempfile,unittest
from unittest.mock import patch
import feather_tools as tools
class SkillLoadingTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.folder=self.root/'demo';(self.folder/'references').mkdir(parents=True)
  (self.folder/'SKILL.md').write_text('---\nname: Demo\ndescription: Main guidance\n---\nCORE_BODY',encoding='utf-8')
  (self.folder/'references/research.md').write_text('RESEARCH_BODY',encoding='utf-8')
  self.env=patch.dict(os.environ,{'FEATHER_SKILLS_DIR':str(self.root)});self.env.start();tools._SKILL_META_CACHE.clear()
 def tearDown(self):self.env.stop();self.temp.cleanup();tools._SKILL_META_CACHE.clear()
 def test_compact_and_file_scoped_reads(self):
  full=tools._feather_getskills(None,{'skill':'demo'})['text'];self.assertIn('CORE_BODY',full);self.assertIn('RESEARCH_BODY',full)
  compact=tools._feather_getskills(None,{'skill':'demo','main_only':True})['text'];self.assertIn('CORE_BODY',compact);self.assertNotIn('RESEARCH_BODY',compact);self.assertIn('references/research.md',compact);self.assertIn('references remain on demand',compact)
  resource=tools._feather_getskills(None,{'skill':'demo','file':'references/research.md'})['text'];self.assertIn('RESEARCH_BODY',resource);self.assertNotIn('CORE_BODY',resource)
 def test_invalid_file_requests(self):
  for args in [{'file':'references/research.md'},{'skill':'demo','file':'../outside'},{'skill':'demo','file':'references/missing.md'},{'skill':'demo','file':'references/research.md','main_only':True},{'skill':'demo','main_only':'yes'}]:
   with self.subTest(args=args),self.assertRaises(tools.NativeError):tools._feather_getskills(None,args)
 def test_pagination_keeps_file_and_skill_scope(self):
  (self.folder/'references/research.md').write_text('evidence line\n'*20000,encoding='utf-8')
  first=tools._feather_getskills(None,{'skill':'demo','file':'references/research.md'})['text'];self.assertIn('PART 1 of 2',first);self.assertIn('"skill": "demo"',first);self.assertIn('"file": "references/research.md"',first)
  second=tools._feather_getskills(None,{'skill':'demo','file':'references/research.md','part':2})['text'];self.assertIn('selected file',second)
 def test_metadata_cache_invalidates_after_edit_and_skips_non_skills(self):
  (self.root/'not-a-skill').mkdir();(self.root/'.archived').mkdir()
  with patch.object(tools,'_skill_text',wraps=tools._skill_text) as read:
   self.assertEqual(len(tools.skills_catalog()),1);self.assertEqual(read.call_count,1);tools.skills_catalog();self.assertEqual(read.call_count,1)
   (self.folder/'SKILL.md').write_text('---\nname: Changed\ndescription: Updated instruction metadata\n---\nNEW',encoding='utf-8')
   self.assertEqual(tools.skills_catalog()[0]['name'],'Changed');self.assertEqual(read.call_count,2)
 def test_merged_skill_alias_preserves_requests_without_catalogue_duplicates(self):
  import json
  (self.root/'.aliases.json').write_text(json.dumps({'old-demo':{'folder':'demo','files':{'references/old.md':'references/research.md'}},'bad':'../outside'}),encoding='utf-8')
  result=tools._feather_getskills(None,{'skill':'old-demo','file':'references/old.md'})['text'];self.assertIn('RESEARCH_BODY',result);self.assertIn('merged into demo',result)
  self.assertEqual([entry['folder'] for entry in tools.skills_catalog()],['demo'])
  with self.assertRaises(tools.NativeError):tools._feather_getskills(None,{'skill':'bad'})

 def test_explicit_pc_scope_reaches_the_catalogue(self):
  (self.folder/'SKILL.md').write_text('---\nname: Local files\ndescription: Inspect local code\nscope: pc\n---\nRead requested files.',encoding='utf-8')
  self.assertEqual(tools.skills_catalog()[0]['scope'],'pc')

if __name__=='__main__':unittest.main()
