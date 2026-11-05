from pathlib import Path
import os
import unittest

from scripts.svg_assets import validate_svg

OPEN = '<svg xmlns="http://www.w3.org/2000/svg">'


class SvgTests(unittest.TestCase):
    def test_passive_shapes_and_internal_paint(self):
        validate_svg(OPEN + '<defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs><rect fill="url(#g)"/></svg>')

    def test_active_and_external_resources_rejected(self):
        examples = [
            '<script>alert(1)</script>', '<foreignObject/>', '<rect onclick="alert(1)"/>',
            '<style>@import url("https://example.com/font.css");</style>',
            '<rect fill="url(https://example.com/image)"/>',
            '<use href="https://example.com/icons.svg#icon"/>',
            '<animate attributeName="href"/>',
        ]
        for content in examples:
            with self.subTest(content=content), self.assertRaises(ValueError):
                validate_svg(OPEN + content + '</svg>')
        with self.assertRaises(ValueError):
            validate_svg('<!DOCTYPE svg>' + OPEN + '</svg>')

    def test_project_svg_assets_are_passive(self):
        root = Path(__file__).resolve().parents[1]
        for directory, folders, files in os.walk(root):
            folders[:] = [folder for folder in folders if folder not in {'node_modules', '.git', 'releases', '__pycache__'}]
            for filename in files:
                if filename.lower().endswith('.svg'):
                    source = Path(directory) / filename
                    validate_svg(source.read_bytes(), str(source.relative_to(root)))


if __name__ == '__main__':
    unittest.main()
