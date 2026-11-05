"""Enforce passive, self-contained SVG artwork in release assets."""
import re
import xml.etree.ElementTree as ET

SVG = 'http://www.w3.org/2000/svg'
PASSIVE_TAGS = {
    'svg', 'defs', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline',
    'polygon', 'text', 'tspan', 'title', 'desc', 'pattern', 'mask',
    'clipPath', 'linearGradient', 'radialGradient', 'stop', 'symbol', 'use',
}


def validate_svg(data, name='SVG asset'):
    text = data.decode('utf-8') if isinstance(data, bytes) else data
    if re.search(r'<!\s*(?:DOCTYPE|ENTITY)', text, re.I):
        raise ValueError(f'{name}: XML document types/entities are not permitted.')
    root = ET.fromstring(text)
    if root.tag != f'{{{SVG}}}svg':
        raise ValueError(f'{name}: expected an SVG document.')
    for node in root.iter():
        tag = node.tag.removeprefix(f'{{{SVG}}}')
        if tag not in PASSIVE_TAGS:
            raise ValueError(f'{name}: active or unsupported SVG element {tag}.')
        for attribute, value in node.attrib.items():
            local = attribute.split('}')[-1]
            if local.lower() in {'style', 'base'} or '\\' in value:
                raise ValueError(f'{name}: stylesheet, base URL and escaped attributes are not permitted.')
            if local.lower().startswith('on'):
                raise ValueError(f'{name}: SVG event handlers are not permitted.')
            if local in {'href', 'src'} and not value.startswith('#'):
                raise ValueError(f'{name}: SVG references must be internal fragments.')
        # Inspect style attributes and style element text as well as presentation
        # attributes such as fill=url(...). Only local paint-server links pass.
        css = ' '.join(node.attrib.values()) + (' '.join(node.itertext()) if tag == 'style' else '')
        if re.search(r'@import\b|expression\s*\(|javascript\s*:', css, re.I):
            raise ValueError(f'{name}: active CSS or imported resources are not permitted.')
        for reference in re.findall(r'url\(\s*([^)]*?)\s*\)', css, re.I):
            if not reference.strip().strip('\"\'').startswith('#'):
                raise ValueError(f'{name}: SVG resource URLs must be internal fragments.')
    return root
