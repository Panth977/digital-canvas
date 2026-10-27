<script lang="ts">
  /** Canva's Photos panel: free photos from Openverse and Wikimedia Commons (and NASA), by topic or search. */
  import type { EditorState } from '../../lib/editor.svelte.ts';
  import BrowsePanel, { type Mode } from './BrowsePanel.svelte';

  let { ed }: { ed: EditorState } = $props();

  const t = (label: string, query = label.toLowerCase()) => ({ label, query });
  const MODES: Mode[] = [{
    id: 'photos', label: 'Photos', opts: {},
    topics: [t('Trending', 'landscape'), t('Nature'), t('Food'), t('Business', 'office work'), t('Travel'), t('Flowers'), t('Animals'), t('Architecture'), t('Abstract'), t('Textures', 'texture'), t('Sky'), t('Ocean'), t('City'), t('Sports'), t('Technology'), t('Coffee'), t('Mountains'), t('Autumn')],
  }];
  const SOURCES = [
    { id: '' as const, label: 'All sources' },
    { id: 'openverse' as const, label: 'Openverse' },
    { id: 'commons' as const, label: 'Wikimedia Commons' },
    { id: 'nasa' as const, label: 'NASA' },
  ];
</script>

<BrowsePanel {ed} kind="photo" placeholder="Search photos" searchTestid="photo-search" resultsTestid="photo-results" modes={MODES} sources={SOURCES}
  credits={'Openly licensed photos via <a href="https://openverse.org" target="_blank" rel="noreferrer">Openverse</a> (licences that allow commercial use and changes), reviewed "Quality images" from <a href="https://commons.wikimedia.org" target="_blank" rel="noreferrer">Wikimedia Commons</a>, and <a href="https://images.nasa.gov" target="_blank" rel="noreferrer">NASA</a> media. Click to add or drag onto the page (or onto a frame). Each photo keeps its credit and licence in the design.'} />
