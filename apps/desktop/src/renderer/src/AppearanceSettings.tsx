import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { colorPresets, interfacePresets, noteFontFamilies, roundingLevels, themeStyle } from "@/lib/theme";
import { Check, ChevronRight, Palette, RotateCcw } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { settingsSchema, type Settings as Preferences, type Snapshot } from "@dock/contracts";
import type { Act } from "./state";

const colorFields = [
  ["background", "Background"], ["card", "Surfaces"], ["foreground", "Text"],
  ["mutedForeground", "Muted text"], ["border", "Borders"], ["primary", "Accent"],
] as const;
const defaults = settingsSchema.parse({});

/** A miniature Dock window drawn with the given settings, used by the tiles and the live preview. */
function MiniWindow({ settings, detailed = false }: { settings: Preferences; detailed?: boolean }) {
  const rail = settings.uiPreset === "ink";
  return (
    <div className={`mini-window ${detailed ? "detailed" : ""} ${settings.density}`} style={themeStyle(settings)} aria-hidden="true">
      <div className="mini-window-bar"><i /><i /><i />{detailed && <span>Dock</span>}</div>
      <div className={`mini-window-body ${rail ? "rail" : ""} ${settings.uiPreset}`}>
        <div className="mini-window-sidebar">
          {["Today", "Inbox", "Upcoming"].map((label, index) => <span key={label} className={index === 0 ? "active" : ""}>
            <b />{detailed && !rail && <em>{label}</em>}
          </span>)}
        </div>
        <div className="mini-window-main">
          {detailed ? <>
            <div className="mini-window-heading"><strong>Today</strong><span className="mini-window-button">New task</span></div>
            {[["Finalize release notes", "P1", "@writing"], ["Review sync changes", "P2", "@review"], ["Water the plants", "", "Every day"]].map(([title, priority, meta]) =>
              <div className="mini-window-row" key={title}>
                <span className={`mini-window-check priority-${priority ? priority[1] : 4}`} />
                <span><strong>{title}</strong><small>{priority && <em className={`priority-${priority[1]}`}>{priority}</em>}{meta}</small></span>
              </div>)}
            <p className="mini-window-note" style={{ fontFamily: noteFontFamilies[settings.noteFont], fontSize: `${settings.noteSize / 16 * 0.75}rem` }}>
              Notes read like this, in your chosen font and size.
            </p>
          </> : <>
            <i className="line strong" /><i className="line" /><i className="line" /><i className="line accent" />
          </>}
        </div>
        {settings.uiPreset === "studio" && <div className="mini-window-inspector"><i className="line" /><i className="line" /></div>}
      </div>
    </div>
  );
}

function Group({ title, description, action, children }: { title: string; description: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="appearance-group" role="group" aria-label={title}>
      <div className="appearance-group-heading">
        <div><h3>{title}</h3><p>{description}</p></div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Tile({ selected, label, detail, onSelect, children }: { selected: boolean; label: string; detail?: string; onSelect: () => void; children: ReactNode }) {
  return (
    <button type="button" className="appearance-tile" aria-pressed={selected} onClick={onSelect}>
      <span className="appearance-tile-art">{children}{selected && <span className="appearance-tile-check"><Check size="0.6875rem" strokeWidth={3} /></span>}</span>
      <span className="appearance-tile-label"><strong>{label}</strong>{detail && <small>{detail}</small>}</span>
    </button>
  );
}

function Segmented<T extends string | number>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string; art: ReactNode }[]; onChange: (value: T) => void;
}) {
  return (
    <div className="appearance-setting">
      <span>{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map(option => <button type="button" key={option.value} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          <span className="segmented-art" aria-hidden="true">{option.art}</span>{option.label}
        </button>)}
      </div>
    </div>
  );
}

export function AppearanceSettings({ draft, setDraft, snapshot, act }: {
  draft: Preferences; setDraft: (settings: Preferences) => void; snapshot: Snapshot; act: Act;
}) {
  const mode = snapshot.settings.theme;
  const preview = { ...draft, theme: mode };
  const palette = colorPresets[draft.colorPreset][mode];
  const colors = draft.themeColors[mode];
  const customized = colorFields.filter(([key]) => colors[key]).length;
  const setColor = (key: keyof typeof palette, value: string | undefined) =>
    setDraft({ ...draft, themeColors: { ...draft.themeColors, [mode]: { ...colors, [key]: value } } });
  return (
    <section className="appearance" aria-label="Appearance">
      <div className="appearance-header">
        <div>
          <h2><Palette size="1.0625rem" /> Appearance</h2>
          <p>Changes apply instantly across Dock and stay on this device.</p>
        </div>
        <Button type="button" variant="ghost" size="xs" onClick={() => setDraft({ ...draft,
          uiPreset: defaults.uiPreset, colorPreset: defaults.colorPreset, rounding: defaults.rounding, density: defaults.density,
          noteFont: defaults.noteFont, noteSize: defaults.noteSize, themeColors: defaults.themeColors })}>
          <RotateCcw size="0.8125rem" />Reset appearance
        </Button>
      </div>
      <div className="appearance-layout">
        <div className="appearance-groups">
          <Group title="Theme" description="Switches every Dock window.">
            <div className="appearance-tiles two">
              {(["dark", "light"] as const).map(theme => <Tile key={theme} label={theme === "dark" ? "Dark" : "Light"} selected={mode === theme}
                onSelect={() => act({ type: "settings.save", settings: { ...snapshot.settings, theme } })}>
                <MiniWindow settings={{ ...draft, theme }} />
              </Tile>)}
            </div>
          </Group>
          <Group title="Layout" description="How navigation and details are arranged.">
            <div className="appearance-tiles four">
              {Object.entries(interfacePresets).map(([id, preset]) => <Tile key={id} label={preset.name} detail={preset.description}
                selected={draft.uiPreset === id} onSelect={() => setDraft({ ...draft, uiPreset: id as Preferences["uiPreset"] })}>
                <MiniWindow settings={{ ...preview, uiPreset: id as Preferences["uiPreset"] }} />
              </Tile>)}
            </div>
          </Group>
          <Group title="Palette" description="A tuned set of colors for light and dark.">
            <div className="appearance-tiles three">
              {Object.entries(colorPresets).map(([name, preset]) => <Tile key={name} label={name} selected={draft.colorPreset === name && !customized}
                onSelect={() => setDraft({ ...draft, colorPreset: name as Preferences["colorPreset"], themeColors: { dark: {}, light: {} } })}>
                <span className="palette-art" style={{ background: preset[mode].background }}>
                  <span style={{ background: preset[mode].card, borderColor: preset[mode].border }}>
                    <i style={{ background: preset[mode].foreground }} /><i style={{ background: preset[mode].mutedForeground }} />
                  </span>
                  <b style={{ background: preset[mode].primary }} />
                </span>
              </Tile>)}
            </div>
            <details className="appearance-custom" open={customized > 0 || undefined}>
              <summary><ChevronRight size="0.875rem" />Customize colors
                <small>{customized ? `${customized} custom in ${mode} mode` : `Based on ${draft.colorPreset}`}</small>
              </summary>
              <div className="appearance-colors">
                {colorFields.map(([key, label]) => {
                  const value = colors[key] ?? palette[key];
                  const valid = /^#[0-9a-f]{6}$/i.test(value);
                  return <div className="appearance-color" key={key}>
                    <input type="color" aria-label={`${label} color picker`} value={valid ? value : palette[key]}
                      onChange={event => setColor(key, event.target.value)} />
                    <span>{label}</span>
                    <Input size="xs" aria-label={`${label} color`} value={colors[key] ?? ""} placeholder={palette[key]} maxLength={7} spellCheck={false}
                      onChange={event => setColor(key, event.target.value || undefined)} />
                    <Button type="button" variant="ghost" size="icon-xs" aria-label={`Reset ${label}`} disabled={!colors[key]}
                      onClick={() => setColor(key, undefined)}><RotateCcw size="0.75rem" /></Button>
                  </div>;
                })}
              </div>
            </details>
          </Group>
          <Group title="Details" description="Shape, spacing and note typography.">
            <div className="appearance-settings">
              <Segmented label="Corners" value={draft.rounding} onChange={rounding => setDraft({ ...draft, rounding })}
                options={Object.entries(roundingLevels).map(([id, level]) => ({ value: id as Preferences["rounding"], label: level.name,
                  art: <span className="corner-art" style={{ borderTopLeftRadius: level.panel }} /> }))} />
              <Segmented label="Density" value={draft.density} onChange={density => setDraft({ ...draft, density })}
                options={(["compact", "comfortable"] as const).map(density => ({ value: density, label: density === "compact" ? "Compact" : "Comfortable",
                  art: <span className={`density-art ${density}`}><i /><i /><i /></span> }))} />
              <Segmented label="Note font" value={draft.noteFont} onChange={noteFont => setDraft({ ...draft, noteFont })}
                options={(["system", "serif", "mono"] as const).map(font => ({ value: font, label: font === "system" ? "Sans" : font === "serif" ? "Serif" : "Mono",
                  art: <span className="font-art" style={{ fontFamily: noteFontFamilies[font] }}>Aa</span> }))} />
              <Segmented label="Note size" value={draft.noteSize} onChange={noteSize => setDraft({ ...draft, noteSize })}
                options={([14, 16, 18] as const).map(size => ({ value: size, label: size === 14 ? "Small" : size === 16 ? "Standard" : "Large",
                  art: <span className="font-art" style={{ fontSize: `${size / 16 * 0.75}rem` } as CSSProperties}>A</span> }))} />
            </div>
          </Group>
        </div>
        <aside className="appearance-preview" aria-label="Live preview">
          <MiniWindow settings={preview} detailed />
          <p><strong>Live preview</strong>{interfacePresets[draft.uiPreset].name} · {customized ? "Custom colors" : draft.colorPreset} · {roundingLevels[draft.rounding].name} corners</p>
        </aside>
      </div>
    </section>
  );
}
