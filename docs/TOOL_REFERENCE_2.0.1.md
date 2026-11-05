# FeatherScript 2.0.1 command reference

67 advertised built-in entry points: 46 Roblox/skills and 21 permission-controlled PC tools. External MCP tools are additional. Common tools stay direct; specialist workflows are grouped to avoid repeating hundreds of parameter schemas in every session.

Use `rbx_workflow_schema` or `pc_operation_schema` with `tool` and `action` for exact parameters. Pass those parameters in the grouped command's `params` object. Schema lookup reads local metadata only. Original operation names remain routable by the bridge for saved integrations. All grouped operations retain their original validators, limits and PC permission checks.

Example: `rbx_workflow_schema` with `{"tool":"rbx_get_inventory","action":"script_inventory"}`, then `rbx_get_inventory` with `{"action":"script_inventory","params":{"root":"game","limit":50}}`.

## Direct tools

| Command | Purpose |
| --- | --- |
| get_properties | Read exact property values of one instance. Omit `properties` for every readable property (via Studio's inspection), or pass names to read only those. Use it before editing values, or whenever the user asks what something is set to. |
| set_properties | Write property values on one instance with automatic type conversion (Vector3 {x,y,z}, Color3 '#rrggbb', UDim2 [sx,ox,sy,oy], Enum names). Use it for simple value changes instead of writing Luau. |
| get_attributes | Read every attribute on an instance (the key/value pairs scripts store with SetAttribute). |
| set_attributes | Create or overwrite attributes on one instance. Values must be strings, numbers or booleans. |
| remove_attributes | Delete named attributes from an instance. |
| get_tags | List the CollectionService tags on an instance. |
| add_tag | Add one CollectionService tag to an instance. |
| remove_tag | Remove one CollectionService tag from an instance. |
| find_tagged | Find every instance carrying a CollectionService tag, optionally limited to one root. |
| list_children | List the direct children of an instance with name, class and child count; raise `depth` to walk deeper. Use it to explore a model/folder before naming paths in other commands. |
| find_instances | Find instances by name wildcard, class and/or tag under a root and return their exact paths. Use it when you know roughly what something is called but not its path - it beats guessing paths for execute_luau. |
| count_instances | Count instances under a root, optionally filtered by class, grouped by ClassName. Use it for audits (how many parts, scripts, lights...) instead of guessing. |
| describe_instance | One-call summary of an instance: class, parent, child count, attributes, tags, and size/position (or model bounds). Use it to orient yourself before editing. |
| get_selection | Read what is currently selected in Studio, with exact paths. |
| select_instances | Select instances in Studio by path so the user sees them highlighted; optionally add to the current selection. |
| get_bounds | World-space center and size of a part or model - useful for placing things without guessing coordinates. |
| get_place_info | Basic place info: name, place/game id, creator, whether Studio is playing, and player count. |
| get_players | List the players currently in the running playtest (name, display name, UserId). |
| find_in_scripts | Search script source text for a plain string and return the script path, line number and the matching line. Use it to locate where a value/name is used before editing. |
| rename_instance | Rename one instance. Use it instead of execute_luau for plain renames. |
| clone_instance | Duplicate one instance (with all descendants) into a parent, optionally with a new name. For repeated copies spaced along an axis, use duplicate_grid instead. |
| delete_instance | Destroy exactly one instance by path, together with its descendants. Refuses services. Before calling it make sure the path is exactly what the user asked to remove - never a container 'to be safe'. |
| reparent_instance | Move one instance to a different parent (keeping its name and contents). |
| create_part | Create one primitive part with useful defaults in a single call (shape, size, position, colour, material, anchoring). Use it for simple props; use generate_mesh / generate_procedural_model for real geometry. |
| create_folder | Create a new Folder under a parent (defaults to Workspace). |
| group_instances | Put existing instances (paths, or the current selection) inside a new Model under one parent. |
| move_instance | Move a part or model to a world position, keeping its rotation. |
| resize_instance | Set the size of a BasePart (in studs). |
| rotate_instance | Set the orientation of a part, or rotate a model, in degrees. |
| snap_to_grid | Snap the position of a part or every part under a model to a stud grid. Useful after procedural or generated placement. |
| align_instances | Align two or more parts/models along one world axis, taking the first path as the reference. Use it to line up rows, shelves, walls or UI props instead of hand-editing positions. |
| duplicate_grid | Clone one instance into a row/column/stack of evenly spaced copies along an axis (fences, pillars, tiles, grids). |
| set_anchored | Anchor or unanchor a part, or every part under a model/folder. Use before moving built structures so physics doesn't scatter them. |
| weld_to | Weld one BasePart to another with a WeldConstraint (keeps their current relative offset). |
| run_client_luau | Run Luau in the running game's CLIENT datamodel (play mode only). Use `return` for output; for edit-time code use execute_luau instead. |
| run_server_luau | Run Luau in the running game's SERVER datamodel (play mode only). Use `return` for output; for edit-time code use execute_luau instead. |
| feather_capture | Screenshot the Roblox Studio viewport and attach the image to the reply. Use it whenever the user asks how something looks, after building/changing UI or visuals, or to check a build from a specific camera angle. |
| feather_capturevideo | Record about 4 seconds of Roblox Studio frames and attach them as a short video in the reply. Use it to show motion - animations, gameplay behaviour, tweens, moving parts - or to check what actually happens during play (start_stop_play {"is_start": true} first). |
| feather_getskills | Read the user's local FeatherScript skills - every folder in their skills library, with SKILL.md plus its references/ and scripts/ files. A skill is a reusable procedure the user wrote or installed (build a shop GUI, level layout rules, scripting conventions...). Call this BEFORE a task that might match one, and whenever the user mentions their skills. With no parameters it returns the library in numbered parts (PART 1 of N); each part ends by naming the call that fetches the next one, so call every part when you need the whole library. Pass "part" to fetch a specific part, or "skill" (a folder name) to read just one skill. Use main_only=true for compact main instructions with a resource index, or skill + file for one listed reference/script. Works even while Roblox Studio is closed. |
| feather_memory | This place's long-term project memory at ServerStorage.FeatherScript.Memory, shared by every AI and every later session. `{"action":"read"}` before the first request that edits the place or needs to know how the game works; `{"action":"append","heading":"Shop GUI","content":"- one durable fact per line"}` whenever something lasting is verified; `{"action":"write"}` only to collapse a memory that grew too long. The folder and script are created on the first write, everything is stored as Luau comments so a write can never break a script, and append needs no exact text match. |
| pc_system_info | Get local OS, home folder and available memory. Subject to desktop PC permissions. |
| pc_stat_path | Describe one file or folder: type, size and timestamps. |
| pc_list_directory | List up to 500 entries in a local folder. |
| pc_search_files | Find files or folders by name pattern under a folder. Does not follow links. |
| pc_read_file | Read a UTF-8 text file, up to 1 MB. Optionally read a line range. |
| pc_write_file | Create or replace a local UTF-8 file, up to 2 MB. Its parent must exist. |
| pc_append_file | Append UTF-8 text to an existing local file, up to 1 MB per call. |
| pc_create_directory | Create a directory inside an existing parent. |
| pc_copy_path | Copy a file or folder. Refuses an existing destination or a link. |
| pc_move_path | Move or rename a file/folder. Refuses a destination that already exists when checked. |
| pc_trash_path | Move a file/folder to the system trash/recycle bin. Always considered unusual. |
| pc_open_path | Open an existing local file/folder with its default application. |
| pc_open_url | Open an http(s) URL in the default browser. Always considered unusual. |
| pc_clipboard_read | Read the current clipboard text. Always considered unusual because it may contain secrets. |
| pc_clipboard_write | Replace the clipboard with text, up to 1 MB. Always considered unusual. |
| pc_run_program | Run a program with explicit arguments as the current OS user. Programs can access the entire account. Always asks in unusual mode; subject to pairing and desktop permissions. |

## Specialist operation groups

### rbx_get_inventory

`animation_inventory`, `attachment_positions`, `attachments`, `attributes_index`, `audio_inventory`, `beams`, `camera_state`, `click_detectors`, `collision_groups`, `constraints`, `decals`, `gui_images`, `gui_inventory`, `gui_text`, `humanoids`, `joints`, `lighting_settings`, `lights`, `mesh_assets`, `model_pivots`, `network_ownership`, `particle_emitters`, `physics_summary`, `prompts`, `remote_inventory`, `scene_summary`, `script_inventory`, `sound_groups`, `spawns`, `tag_inventory`, `teams`, `terrain_settings`, `textures`, `trails`, `workspace_settings`.

### rbx_audit_scene

`broken_constraints`, `collidable_decoration`, `deprecated_movers`, `disabled_scripts`, `duplicate_assets`, `duplicate_names`, `empty_models`, `empty_scripts`, `empty_text_labels`, `invisible_buttons`, `missing_primary_parts`, `missing_sound_ids`, `orphan_attachments`, `orphan_effects`, `remote_locations`, `script_risks`, `ui_overflow`, `unanchored_parts`, `zero_size_parts`.

### rbx_edit_batch

`add_tag`, `disable_scripts`, `enable_effects`, `name_prefix`, `name_suffix`, `pivot_offset`, `remove_attribute`, `remove_tag`, `scale_models`, `set_archivable`, `set_attribute`, `set_collision`, `set_collision_group`, `set_color`, `set_image`, `set_layout_order`, `set_locked`, `set_massless`, `set_material`, `set_orientation`, `set_reflectance`, `set_shadows`, `set_size`, `set_streaming_mode`, `set_text`, `set_text_color`, `set_text_size`, `set_transparency`, `set_visible`, `set_zindex`.

### rbx_create_object

`align_orientation`, `align_position`, `attachment`, `beam`, `canvas_group`, `checkpoint`, `click_detector`, `collision_group`, `cylinder_part`, `frame`, `highlight`, `hinge_constraint`, `image_button`, `image_label`, `part_block`, `particle_emitter`, `point_light`, `proximity_prompt`, `rope_constraint`, `screen_gui`, `scrolling_frame`, `seat`, `sound`, `sound_group`, `spawn`, `spot_light`, `spring_constraint`, `surface_light`, `team`, `text_box`, `text_button`, `text_label`, `trail`, `ui_aspect`, `ui_corner`, `ui_grid_layout`, `ui_list_layout`, `ui_padding`, `ui_size_constraint`, `ui_stroke`, `vehicle_seat`, `viewport_frame`, `wedge_part`, `weld_constraint`.

### rbx_configure_scene

`camera_view`, `lighting_preset`.

### pc_file_operations

`compare_files`, `delete_lines`, `detect_encoding`, `diff_files`, `directory_recent_files`, `directory_summary`, `directory_tree`, `file_byte_sample`, `file_exists`, `file_hash`, `file_head`, `file_lines`, `file_tail`, `find_duplicates`, `find_largest_files`, `find_text`, `insert_lines`, `list_extensions`, `remove_empty_directory`, `replace_text`, `search_text`, `touch_path`, `truncate_file`, `write_bytes`.

### pc_data_operations

`csv_distinct`, `csv_filter`, `csv_group`, `csv_info`, `csv_preview`, `csv_row_lookup`, `csv_select_columns`, `csv_sort`, `csv_to_json`, `json_delete`, `json_diff`, `json_flatten`, `json_format`, `json_merge`, `json_merge_into`, `json_paths`, `json_query`, `json_read`, `json_set`, `json_to_csv`, `json_validate`, `markdown_headings`, `markdown_links`, `markdown_toc`, `regex_extract`, `text_between`, `text_dedupe_lines`, `text_duplicate_lines`, `text_normalize`, `text_replace_regex`, `text_sort_lines`, `text_stats`.

### pc_git_operations

`ahead_behind`, `blame`, `branches`, `check_ignore`, `config`, `count_objects`, `diff`, `grep`, `head`, `log`, `ls_files`, `ls_tree`, `reflog`, `remotes`, `shortlog`, `show_commit`, `show_file`, `stash_list`, `status`, `tags`, `worktrees`.

### pc_system_operations

`disk_space`, `dns_lookup`, `env_vars`, `http_get`, `network_interfaces`, `port_probe`, `process_list`, `which`.

## Performance

The built-in schema payload is 32,546 bytes, down from 122,682 bytes (73.5% smaller, compact UTF-8 JSON). This reduces catalogue transfers, rendering and prompt overhead; it is not a provider response-time benchmark. Start retains cached hydration and a single in-flight refresh. The cache key was advanced to discard the old oversized catalogue.
