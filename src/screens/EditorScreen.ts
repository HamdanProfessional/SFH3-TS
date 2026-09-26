import { Screen } from "../core/Screen";
import type { Engine } from "../core/Engine";
import { EditorView, newEditorState, type EditorState } from "../editor/EditorView";
import { endPlayTest, playCustomMap, playCustomMission } from "../editor/playtest";
import { fetchShared, reportPlay } from "../editor/store";
import { cloneMap, type CustomMap } from "../editor/format";

export class EditorScreen extends Screen {
  private ui: EditorView | null = null;
  private gone = false;

  constructor(engine: Engine, arg?: unknown) {
    super(engine, arg);
    endPlayTest();
    const a = arg as Partial<EditorState> & { shared?: string; copy?: CustomMap } | undefined;
    if (a && a.map) {
      this.open(a as EditorState);
    } else if (a?.copy) {
      this.open({ ...newEditorState(cloneMap(a.copy)), notice: a.notice });
    } else if (a?.shared) {
      const id = a.shared;
      void fetchShared(id).then(
        (s) => this.open({
          ...newEditorState(s.map), sharedId: s.id, author: s.author,
          brief: !!s.map.mission, tab: s.map.mission ? "mission" : "map",
        }),
        (e: unknown) => this.open({
          ...newEditorState(),
          notice: `Could not open that map link: ${e instanceof Error ? e.message : "unknown error"}`,
        }),
      );
    } else {
      this.open(newEditorState());
    }
  }

  private open(state: EditorState): void {
    if (this.gone) return;
    const leave = (): void => { this.ui?.unmount(); this.ui = null; };
    this.ui = new EditorView(state, {
      play: (s) => {
        leave();
        if (s.sharedId && !s.dirty) reportPlay(s.sharedId);
        playCustomMap(this.engine, s.map, s.play, { screen: EditorScreen, arg: s });
      },
      playMission: (s) => {
        leave();
        playCustomMission(this.engine, s.map, { screen: EditorScreen, arg: s },
          (r) => { s.result = r; });
      },
      exit: () => {
        leave();
        void import("./MenuScreen").then((m) => this.engine.setScreen(m.MenuScreen, "missions"));
      },
      browse: () => {
        leave();
        void import("./MenuScreen").then((m) => this.engine.setScreen(m.MenuScreen, "mapBrowser"));
      },
    });
    this.ui.mount();
  }

  enterFrame(_dt: number): void {}

  resize(): void {}

  destructor(): void {
    this.gone = true;
    this.ui?.unmount();
    this.ui = null;
    if (typeof location !== "undefined" && location.hash.startsWith("#cmap=")) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    super.destructor();
  }
}
