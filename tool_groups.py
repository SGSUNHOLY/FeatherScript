"""Compact operation catalogues with on-demand schemas and strict routing.

Specialist implementations remain callable for saved tasks, but no longer repeat
their full schemas in every session. Execution still uses the original validator.
"""
from copy import deepcopy


class GroupedCatalogue:
    def __init__(self, definitions, classify, descriptions, help_name, server=None):
        self.originals = {item['name']: item for item in definitions}
        if len(self.originals) != len(definitions):
            raise ValueError('Duplicate operation definitions')
        self.routes = {}
        self.definitions = []
        self.help_name = help_name
        for item in definitions:
            group, action = classify(item['name'])
            routes = self.routes.setdefault(group, {})
            if action in routes:
                raise ValueError('Duplicate grouped action: ' + action)
            routes[action] = item['name']
        for group, routes in self.routes.items():
            self.definitions.append(self._tool(group,
                descriptions[group] + ' Use ' + help_name + ' with tool and action for exact parameters before an unfamiliar operation.', {
                    'action': {'type': 'string', 'enum': sorted(routes)},
                    'params': {'type': 'object', 'description': 'Operation parameters from the schema lookup; omit for operations with no required parameters.'},
                }, ['action'], server))
        self.definitions.append(self._tool(help_name,
            'Read the exact parameter schema and description for one grouped operation. Local metadata only; does not execute it.', {
                'tool': {'type': 'string', 'enum': sorted(self.routes)},
                'action': {'type': 'string', 'minLength': 1, 'maxLength': 100},
            }, ['tool', 'action'], server))
        self.names = set(self.routes) | {help_name}

    @staticmethod
    def _tool(name, description, properties, required, server):
        tool = {'name': name, 'description': description, 'inputSchema': {
            'type': 'object', 'properties': properties, 'required': required,
            'additionalProperties': False}}
        if server:
            tool['server'] = server
        return tool

    def _name(self, group, action):
        if not isinstance(group, str) or not isinstance(action, str):
            raise ValueError('Tool and action must be strings')
        name = self.routes.get(group, {}).get(action)
        if not name:
            raise ValueError('Unknown operation for ' + group + ': ' + action)
        return name

    def resolve(self, group, arguments):
        if not isinstance(arguments, dict) or set(arguments) - {'action', 'params'}:
            raise ValueError('Expected action and optional params only')
        name = self._name(group, arguments.get('action'))
        params = arguments.get('params', {})
        if not isinstance(params, dict):
            raise ValueError('params must be an object')
        return name, dict(params)

    def describe(self, arguments):
        if not isinstance(arguments, dict) or set(arguments) != {'tool', 'action'}:
            raise ValueError('Expected tool and action only')
        original = self.originals[self._name(arguments['tool'], arguments['action'])]
        return deepcopy({key: original[key] for key in ('name', 'description', 'inputSchema')})
