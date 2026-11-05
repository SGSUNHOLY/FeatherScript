"use strict";
(() => {
  const modules = globalThis.FSRenderer ||= {};
  modules.createProfiles = ({ $, state, api, emptyData, hydrateApp, renderAll, flash, socket, reduceMotion, onNavigate, clearPendingSaves }) => {
    // Local profiles replace credential-based accounts; each profile retains its data.
    function renderProfiles() {
      const select = $("#profile-select");
      $("#profile-remove").disabled = state.profiles.length < 2 || state.switchingProfile;
      select.replaceChildren(...state.profiles.map((profile) => {
        const option = document.createElement("option"); option.value = profile.id; option.textContent = profile.name;
        option.selected = profile.id === state.user?.id; return option;
      }));
    }
    async function changeProfile(action, input) {
      if (state.switchingProfile) return;
      state.switchingProfile = true;
      $("#profile-remove").disabled = true;
      document.activeElement?.blur();
      $(".workspace").classList.add("is-profile-changing");
      $("#profile-select").disabled = $("#new-profile-create").disabled = true;
      $("#profiles-status").textContent = "Saving your current profile…";
      clearPendingSaves();
      try {
        const saved = await Promise.all([api.data.save("memory", state.data.memory), api.data.save("notes", state.data.notes), api.data.save("settings", state.data.settings)]);
        if (saved.some((result) => !result.ok)) throw Error("Could not save the current profile. Please try again.");
        const result = action === "remove" ? await api.profiles.remove(input.id) : action === "create" ? await api.profiles.create(input) : await api.profiles.select(input.id);
        if (!result.ok) throw Error(result.error);
        state.user = result.user; state.profiles = result.profiles;
        state.data = { ...emptyData(), ...result.data }; state.avatarDraft = "";
        hydrateApp(); renderAll();
        flash($("#memory-state"), "Saved"); flash($("#prompt-state"), "Saved");
        $("#new-profile-name").value = "";
        $("#profiles-status").textContent = `Using ${state.user.name} · saved locally`;
        socket.send({ type: "set_theme", theme: state.data.settings.theme });
        if (!reduceMotion) $(".workspace").animate([{ opacity: .4, transform: "translateY(5px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 240, easing: "ease-out" });
      } catch (error) { $("#profiles-status").textContent = error.message; renderProfiles(); }
      finally {
        state.switchingProfile = false;
        renderProfiles();
        $(".workspace").classList.remove("is-profile-changing");
        $("#profile-select").disabled = $("#new-profile-create").disabled = false;
      }
    }
    $("#profile-remove").addEventListener("click", () => changeProfile("remove", {id:state.user.id}));
    $("#profile-select").addEventListener("change", (event) => changeProfile("select", { id: event.target.value }));
    $("#new-profile-form").addEventListener("submit", (event) => { event.preventDefault(); changeProfile("create", { name: $("#new-profile-name").value }); });
    $("#side-profile-switch").addEventListener("click", () => {
      onNavigate("settings"); $("#profile-select").scrollIntoView({ behavior: reduceMotion ? "instant" : "smooth", block: "center" }); $("#profile-select").focus({ preventScroll: true });
    });


    return { render: renderProfiles };
  };
})();
