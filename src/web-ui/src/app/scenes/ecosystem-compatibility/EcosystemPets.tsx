import { useEffect, useId, useState } from 'react';
import { Alert, Button, Card, CardBody, CardHeader, DialogBody, DialogFooter, DialogHeader, DialogTitle, Icon, IconButton, LoadingState, OverflowText, StatusPill } from '@openbitfun/ui';
import { PawPrint } from 'lucide-react';
import { EcosystemDialog as Dialog } from './EcosystemDialog';
import { useI18n } from '@/infrastructure/i18n';
import { globalEventBus } from '@/infrastructure/event-bus';
import { getActiveSurfaceScope } from '@/infrastructure/peer-device/deviceSurface';
import { AGENT_COMPANION_PETS_CHANGED, importReviewedAgentCompanionPet, listExternalAgentCompanionPets, type ExternalPetCandidate, type ExternalPetCatalog } from '@/infrastructure/config/services/AgentCompanionPetService';
import { configAPI } from '@/infrastructure/api/service-api/ConfigAPI';
import { aiExperienceConfigService } from '@/infrastructure/config/services/AIExperienceConfigService';
import { useSettingsStore } from '@/app/scenes/settings/settingsStore';
import { useSceneStore } from '@/app/stores/sceneStore';

interface Props { supported: boolean; refreshVersion: number; expanded: boolean; onToggle: () => void }

export default function EcosystemPets({ supported, refreshVersion, expanded, onToggle }: Props) {
  const { t, formatNumber } = useI18n('scenes/ecosystem-compatibility');
  const id = useId();
  const [revision, setRevision] = useState(0);
  const [catalog, setCatalog] = useState<ExternalPetCatalog | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<ExternalPetCandidate | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setCatalog(null); setSelectedPath(null); setFailed(false);
    if (!supported) { setReview(null); setLoading(false); return; }
    const scope = getActiveSurfaceScope();
    setLoading(true);
    void Promise.all([listExternalAgentCompanionPets(), configAPI.getConfig('app.ai_experience')]).then(([next, settings]) => {
      if (!current || !scope.isCurrent()) return;
      setCatalog(next);
      setSelectedPath(settings?.enable_agent_companion ? settings.agent_companion_pet?.packagePath ?? null : null);
    }).catch(() => { if (current && scope.isCurrent()) setFailed(true); })
      .finally(() => { if (current && scope.isCurrent()) setLoading(false); });
    return () => { current = false; };
  }, [supported, refreshVersion, revision]);
  useEffect(() => {
    if (!supported) return;
    const refresh = () => setRevision((value) => value + 1);
    const off = globalEventBus.on(AGENT_COMPANION_PETS_CHANGED, refresh);
    const stop = aiExperienceConfigService.addChangeListener(refresh);
    window.addEventListener('focus', refresh);
    return () => { off(); stop(); window.removeEventListener('focus', refresh); };
  }, [supported]);
  const entries = supported ? catalog?.candidates ?? [] : [];
  const state = !supported ? 'unsupported' : loading ? 'loading' : failed ? 'failed'
    : catalog?.diagnostics.length ? 'partial' : entries.length ? 'available' : 'empty';
  const manage = () => {
    if (!supported) return;
    useSettingsStore.getState().openDestination({ pageId: 'application.pet' });
    useSceneStore.getState().openScene('settings');
  };
  const apply = async () => {
    if (!supported || !review || busy) return;
    const scope = getActiveSurfaceScope();
    setBusy(true); setFeedback(null);
    try {
      await importReviewedAgentCompanionPet(review);
      if (!scope.isCurrent()) return;
      setReview(null); setRevision((v) => v + 1);
    } catch {
      if (scope.isCurrent()) { setReview(null); setFeedback(t('content.pets.operationFailed')); setRevision((v) => v + 1); }
    } finally { setBusy(false); }
  };
  const usePet = async (candidate: ExternalPetCandidate) => {
    if (!supported || busy) return;
    const scope = getActiveSurfaceScope();
    setBusy(true); setFeedback(null);
    try {
      const latest = await listExternalAgentCompanionPets();
      if (!scope.isCurrent()) return;
      const copy = latest.candidates.find((entry) => entry.sourceKey === candidate.sourceKey)?.imported;
      if (!copy || copy.packagePath !== candidate.imported?.packagePath) throw new Error('Pet copy changed');
      await aiExperienceConfigService.saveSettings({ agent_companion_pet: copy, enable_agent_companion: true });
      if (scope.isCurrent()) setRevision((v) => v + 1);
    } catch { if (scope.isCurrent()) { setFeedback(t('content.pets.operationFailed')); setRevision((v) => v + 1); } }
    finally { setBusy(false); }
  };
  return <div data-content-group="pet" role="rowgroup" className="ecosystem-compatibility__content-group">
    <div role="row" className="ecosystem-compatibility__content-summary">
      <span role="cell" className="ecosystem-compatibility__import-item">
        <span className="ecosystem-compatibility__import-item-icon"><Icon glyph={PawPrint} size="md" /></span>
        <span className="ecosystem-compatibility__import-item-copy"><strong>{t('capabilities.pet')}</strong><small>{t('content.pets.description')}</small></span>
      </span>
      <span role="cell">Codex</span>
      <span role="cell" className="ecosystem-compatibility__content-summary-state">
        <StatusPill tone="neutral">{state === 'loading' ? t('loading') : t(`content.pets.states.${state}`)}</StatusPill>
        <IconButton size="sm" variant="quiet" icon={<Icon name={expanded ? 'chevron-down' : 'chevron-right'} size="sm" />} aria-expanded={expanded} aria-controls={id}
          aria-label={t(expanded ? 'content.collapseCategory' : 'content.expandCategory', { type: t('capabilities.pet') })}
          onClick={() => { if (!expanded) setRevision((v) => v + 1); onToggle(); }} />
      </span>
    </div>
    <div role="row" hidden={!expanded}><div role="cell" aria-colspan={3} id={id} className="ecosystem-compatibility__content-expanded">
      {expanded ? <>
        <div className="ecosystem-compatibility__content-filters">
          <Button size="sm" variant="outline" disabled={!supported || loading || busy} onClick={() => setRevision((v) => v + 1)}>{t('content.refresh')}</Button>
          {entries.length > 0 ? <span>{t('content.groupSummary', { count: formatNumber(entries.length) })}</span> : null}
        </div>
        {loading && supported ? <LoadingState size="sm">{t('loading')}</LoadingState> : null}
        {feedback && supported ? <Alert tone="error" message={feedback} /> : null}
        {['unsupported', 'failed', 'empty'].includes(state) ? <Alert tone="info" message={t(`content.pets.states.${state}`)} /> : null}
        {supported && catalog?.diagnostics.length ? <Alert tone="info" message={t('content.pets.partial')} description={catalog.diagnostics.join('\n')} /> : null}
        <div className="ecosystem-compatibility__pet-list">
          {entries.map((candidate) => {
            const using = !!candidate.imported && candidate.imported.packagePath === selectedPath;
            const status = candidate.copyModified ? 'copyModified' : candidate.sourceChanged ? 'sourceChanged' : using ? 'using' : candidate.imported ? 'imported' : 'ready';
            return <Card key={candidate.sourceKey} appearance="subtle" padding="sm" gap="sm" data-pet-source={candidate.sourceKey}>
              <div className="ecosystem-compatibility__pet-row">
                <img className="ecosystem-compatibility__pet-preview" src={candidate.previewDataUrl} alt={candidate.pet.displayName} />
                <CardHeader title={<OverflowText>{candidate.pet.displayName}</OverflowText>} description={<OverflowText>{candidate.pet.packagePath}</OverflowText>} />
                <StatusPill tone="neutral">{t(`content.pets.states.${status}`)}</StatusPill>
              </div>
              <CardBody>
                <div className="ecosystem-compatibility__account-actions">
                  {candidate.imported ? <><Button size="sm" variant="outline" disabled={busy || loading || using} onClick={() => void usePet(candidate)}>{t(using ? 'content.pets.states.using' : 'content.pets.use')}</Button>
                    <Button size="sm" variant="text" onClick={manage}>{t('content.manageCopy')}</Button></>
                    : <Button size="sm" variant="outline" disabled={busy || loading} onClick={() => { setFeedback(null); setReview(candidate); }}>{t('content.prepareImport')}</Button>}
                </div>
              </CardBody>
            </Card>;
          })}
        </div>
      </> : null}
    </div></div>
    <Dialog open={supported && !!review} onOpenChange={(open) => { if (!open && !busy) setReview(null); }}>
      <DialogHeader><DialogTitle>{t('content.pets.reviewTitle')}</DialogTitle></DialogHeader>
      <DialogBody>{review && supported ? <div className="ecosystem-compatibility__content-detail">
        <img className="ecosystem-compatibility__pet-preview" src={review.previewDataUrl} alt={review.pet.displayName} />
        <strong>{review.pet.displayName}</strong><p>{review.pet.packagePath}</p><p>{t('content.pets.reviewDescription')}</p>
      </div> : null}</DialogBody>
      <DialogFooter><Button size="sm" variant="outline" disabled={busy} onClick={() => setReview(null)}>{t('content.cancel')}</Button><Button size="sm" variant="primary" disabled={busy || !supported} onClick={() => void apply()}>{t('content.confirm')}</Button></DialogFooter>
    </Dialog>
  </div>;
}
