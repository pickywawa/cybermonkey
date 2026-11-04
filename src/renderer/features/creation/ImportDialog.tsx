import { FileUp, Sparkles, ListPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  casesToPrompt,
  casesToSkeleton,
  IMPORT_FORMATS,
  type ImportFormat,
  type ImportResult,
} from '../../../shared/domain/external';
import { appendChildren, makeNode } from '../../../shared/domain/scenario';
import { importCases } from '../../../shared/importers/parsers';
import { call } from '../../shared/api';
import { useT } from '../../shared/i18n';
import { Badge, Button, Field } from '../../shared/ui/controls';
import { ErrorNotice } from '../../shared/ui/notices';
import { Modal } from '../../shared/ui/overlays';
import { useActions, useApp } from '../../app/store';

/**
 * Bring test cases from Squash TM, TestRail, Azure Test Plans, Gherkin, CSV/JSON or Markdown, then either have the AI
 * automate them on the devices or import them as empty skeletons to bind by hand.
 */
export function ImportDialog({
  onClose,
  onGenerate,
}: {
  onClose: () => void;
  onGenerate: (prompt: string) => void;
}) {
  const t = useT();
  const { project, settings } = useApp();
  const actions = useActions();
  const [format, setFormat] = useState<ImportFormat>('auto');
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [pasted, setPasted] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<unknown>(null);
  const content = file?.content ?? pasted;
  const result = useMemo<ImportResult | null>(() => {
    if (!content.trim()) return null;
    try {
      return importCases(format, file?.name, content);
    } catch {
      return null;
    }
  }, [content, format, file?.name]);
  const cases = result?.cases ?? [];
  const key = (c: { tool: string; id: string }) => c.tool + ':' + c.id;
  const chosen = cases.filter((c) => selected.has(key(c)));
  useEffect(() => setSelected(new Set((result?.cases ?? []).map(key))), [result]);
  const pick = async () => {
    try {
      const f = await call('imports.pickFile');
      if (f) {
        setFile(f);
        setError(null);
      }
    } catch (e) {
      setError(e);
    }
  };
  const skeleton = async () => {
    if (!project) return;
    const nodes = casesToSkeleton(chosen, (kind, name) => makeNode(kind, name, []));
    await actions.updateProject({
      nodes: appendChildren(project.nodes, null, nodes),
      selectedNodeId: nodes[0]?.id,
    });
    onClose();
  };
  return (
    <Modal
      size="wide"
      title={t('imp.title')}
      icon={<FileUp size={16} color="var(--accent)" />}
      onClose={onClose}
      footer={
        <>
          <span className="note grow">{t('imp.selected', { n: chosen.length })}</span>
          <Button
            icon={<ListPlus size={14} />}
            disabled={!chosen.length}
            onClick={() => void skeleton()}
          >
            {t('imp.skeleton')}
          </Button>
          <Button
            variant="primary"
            icon={<Sparkles size={14} />}
            disabled={!chosen.length}
            onClick={() => {
              onGenerate(casesToPrompt(chosen, settings?.language));
              onClose();
            }}
          >
            {t('imp.generate')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <p className="note">{t('imp.intro')}</p>
        {error != null && <ErrorNotice error={error} />}
        <div className="grid2">
          <Field label={t('imp.format')}>
            <select
              value={format}
              onChange={(e) => {
                setFormat(e.target.value as ImportFormat);
              }}
            >
              {IMPORT_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {t(`imp.fmt.${f}` as never)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('imp.file')}>
            <Button icon={<FileUp size={14} />} onClick={pick}>
              {file ? file.name : t('imp.choose')}
            </Button>
          </Field>
        </div>
        {!file && (
          <Field label={t('imp.paste')}>
            <textarea
              rows={5}
              className="mono"
              value={pasted}
              placeholder={t('imp.pastePh')}
              onChange={(e) => setPasted(e.target.value)}
            />
          </Field>
        )}
        {result && (
          <div className="row wrap">
            <Badge tone="accent">{t(`imp.fmt.${result.format}` as never)}</Badge>
            <Badge>{t('imp.cases', { n: cases.length })}</Badge>
          </div>
        )}
        {result?.warnings.slice(0, 6).map((w, i) => (
          <div key={i} className="notice warn">
            {w}
          </div>
        ))}
        {cases.length > 0 && (
          <div className="prop-tree" style={{ maxHeight: 300 }}>
            {cases.map((c) => (
              <label key={key(c)} className="prop-row" style={{ paddingLeft: 8 }}>
                <input
                  type="checkbox"
                  checked={selected.has(key(c))}
                  onChange={(e) =>
                    setSelected((s) => {
                      const n = new Set(s);
                      e.target.checked ? n.add(key(c)) : n.delete(key(c));
                      return n;
                    })
                  }
                />
                <b className="ellipsis grow">{c.title}</b>
                <span className="note">{c.id}</span>
                <Badge>{t('imp.steps', { n: c.steps.length })}</Badge>
              </label>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
