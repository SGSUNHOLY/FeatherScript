'use strict';
(() => {
  const modules = globalThis.FSRenderer ||= {};
  modules.createAppearance = ({ $, state, api, settingsPayload, refresh }) => {
    const model = FSAppearance;
    let draft = model.normalize(), photoGeneration = 0, saving = false, layoutGeneration = 0, requestedLayout = null;
    const keys = Object.keys(model.tokens(draft));
    const status = message => { $('#appearance-status').textContent = message; };
    function apply() {
      const changed = document.body.dataset.layout !== draft.layout;
      document.body.dataset.layout = draft.layout;
      document.body.classList.toggle('layout-studio', draft.layout !== 'default');
      for (const button of document.querySelectorAll('[data-layout-choice]')) button.setAttribute('aria-pressed', String(button.dataset.layoutChoice === draft.layout));
      if (changed) window.dispatchEvent(new Event('fs:layoutchange'));
      for (const key of keys) document.body.style.removeProperty(key);
      document.body.style.removeProperty('color-scheme');
      document.body.classList.toggle('has-custom-scene', draft.enabled && draft.mode !== 'solid');
      if (draft.enabled) {
        const tokens = model.tokens(draft);
        for (const [key, value] of Object.entries(tokens)) document.body.style.setProperty(key, value);
        document.body.style.colorScheme = model.luminance(draft.canvas) > .4 ? 'light' : 'dark';
      }
      refresh?.();
    }
    function preview() {
      const card = $('#appearance-preview');
      for (const [key, value] of Object.entries(model.tokens({ ...draft, enabled: true }))) card.style.setProperty(key, value);
      $('#appearance-preview-name').textContent = draft.name;
      const ratio = model.contrast(draft.text, draft.surface);
      $('#appearance-contrast').textContent = `${ratio.toFixed(1)}:1 text contrast${ratio < 4.5 ? ' · choose more distinct text and surface colors' : ' · readable'}`;
      $('#appearance-contrast').dataset.tone = ratio < 4.5 ? 'warn' : 'ok';
      $('#appearance-angle-value').textContent = `${draft.angle}°`;
      $('#appearance-overlay-value').textContent = `${draft.overlay}%`;
      $('#appearance-photo-name').textContent = draft.photo ? 'Local photo ready' : 'PNG, JPEG or WebP · up to 12 MB';
      $('#appearance-remove-photo').disabled = !draft.photo;
      $('#appearance-gradient-controls').hidden = draft.mode !== 'gradient';
      $('#appearance-photo-controls').hidden = draft.mode !== 'photo';
    }
    function render() {
      $('#appearance-enabled').checked = draft.enabled;
      for (const key of ['name', 'accent', 'canvas', 'surface', 'text', 'mode', 'from', 'to', 'angle', 'overlay']) $('#appearance-' + key).value = draft[key];
      preview(); apply();
    }
    function hydrate(value) {
      photoGeneration++; layoutGeneration++;
      modules.layoutTransition.cancel(); requestedLayout = null;
      draft = model.normalize(value);
      saving = false; $('#appearance-save').disabled = false;
      $('#appearance-photo').value = '';
      status('Desktop appearance · saved with this local profile.');
      render();
    }
    for (const button of document.querySelectorAll('[data-layout-choice]')) button.addEventListener('click', async () => {
      if (state.switchingProfile || (requestedLayout ?? draft.layout) === button.dataset.layoutChoice) return;
      const generation = ++layoutGeneration, profile = state.user?.id;
      const settings = state.data.settings, previous = model.normalize(settings.appearance).layout;
      const next = button.dataset.layoutChoice; requestedLayout = next;
      try {
        await modules.layoutTransition.run(() => {
          if (generation !== layoutGeneration || profile !== state.user?.id) return;
          draft.layout = next;
          settings.appearance = model.normalize({...settings.appearance, layout:next});
          apply(); $('#layout-status').textContent = 'Saving layout…';
        });
        if (generation !== layoutGeneration || profile !== state.user?.id) return;
        const result = await api.data.save('settings', settingsPayload(), profile);
        if (!result.ok) throw Error(result.error || 'Layout could not be saved.');
        if (generation === layoutGeneration && profile === state.user?.id) $('#layout-status').textContent = 'Layout saved to this local profile.';
      } catch (error) {
        if (generation === layoutGeneration && profile === state.user?.id) {
          draft.layout = previous; settings.appearance = model.normalize({...settings.appearance, layout:previous}); apply(); $('#layout-status').textContent = error.message;
        }
      } finally { if (generation === layoutGeneration) requestedLayout = null; }
    });
    $('#appearance-form').addEventListener('input', event => {
      const key = event.target.dataset.appearance;
      if (!key) return;
      draft = model.normalize({ ...draft, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value });
      preview(); apply(); status('Live preview · save to keep your changes.');
    });
    $('#appearance-reset').addEventListener('click', () => {
      photoGeneration++;
      draft = model.normalize({layout: draft.layout}); render(); status('Preset restored in preview · save to keep this choice.');
    });
    $('#appearance-remove-photo').addEventListener('click', () => {
      photoGeneration++; draft.photo = ''; $('#appearance-photo').value = '';
      preview(); apply(); status('Photo removed in preview.');
    });
    $('#appearance-photo').addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      const generation = ++photoGeneration;
      const profile = state.user?.id;
      let url;
      try {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) throw Error('Choose a PNG, JPEG or WebP photo smaller than 12 MB.');
        status('Preparing your local photo…');
        url = URL.createObjectURL(file);
        const image = new Image(); image.src = url; await image.decode();
        const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) throw Error('Photo processing is unavailable.');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const photo = model.photo(canvas.toDataURL('image/jpeg', .8));
        if (!photo) throw Error('That photo is too large after processing. Try a smaller image.');
        if (generation !== photoGeneration || profile !== state.user?.id) return;
        draft = model.normalize({ ...draft, enabled: true, mode: 'photo', photo });
        render(); status('Photo ready · save to keep it in this local profile.');
      } catch (error) { if (generation === photoGeneration) status(error.message); }
      finally { if (url) URL.revokeObjectURL(url); event.target.value = ''; }
    });
    $('#appearance-form').addEventListener('submit', async event => {
      event.preventDefault();
      if (saving || state.switchingProfile) return;
      if (draft.enabled && draft.mode === 'photo' && !draft.photo) { status('Choose a photo, or select a different background.'); return; }
      saving = true; $('#appearance-save').disabled = true;
      const settings = state.data.settings, previous = settings.appearance;
      const profile = state.user?.id, generation = photoGeneration;
      settings.appearance = model.normalize(draft);
      try {
        const result = await api.data.save('settings', settingsPayload(), profile);
        if (!result.ok) throw Error(result.error || 'Appearance could not be saved.');
        if (profile === state.user?.id && generation === photoGeneration) status('Your studio, saved on this device.');
      } catch (error) {
        settings.appearance = previous;
        if (profile === state.user?.id) status(error.message);
      } finally {
        if (profile === state.user?.id) { saving = false; $('#appearance-save').disabled = false; }
      }
    });
    return { hydrate, apply, usePreset() {
      photoGeneration++; draft.enabled = false;
      state.data.settings.appearance = model.normalize(draft);
      render(); status('Preset selected. Your custom palette is kept for later.');
    } };
  };
})();
