<script lang="ts">
  /** Canva's Videos panel: free video clips from Wikimedia Commons and NASA. Hover plays a preview. */
  import type { EditorState } from '../../lib/editor.svelte.ts';
  import { LIMITS, mb } from '../../lib/content/insert.svelte.ts';
  import BrowsePanel, { type Mode } from './BrowsePanel.svelte';

  let { ed }: { ed: EditorState } = $props();

  const t = (label: string, query = label.toLowerCase()) => ({ label, query });
  const MODES: Mode[] = [{
    id: 'videos', label: 'Videos', opts: {},
    topics: [t('Nature'), t('Ocean'), t('Space', 'earth from space'), t('Sky', 'clouds'), t('City'), t('Animals'), t('Water'), t('Fire'), t('Timelapse'), t('Birds'), t('Forest'), t('Rain'), t('Sunset'), t('Snow'), t('Rocket launch')],
  }];
  const SOURCES = [
    { id: '' as const, label: 'All sources' },
    { id: 'commons' as const, label: 'Wikimedia Commons' },
    { id: 'nasa' as const, label: 'NASA' },
  ];
</script>

<BrowsePanel {ed} kind="video" placeholder="Search videos" searchTestid="video-search" resultsTestid="video-results" modes={MODES} sources={SOURCES}
  credits={`Free video from <a href="https://commons.wikimedia.org" target="_blank" rel="noreferrer">Wikimedia Commons</a> (free licences, WebM) and <a href="https://images.nasa.gov" target="_blank" rel="noreferrer">NASA</a> (no US copyright). Hover to preview; click or drag to add. Clips up to ${mb(LIMITS.video)} are downloaded into the design with their credit.`} />
