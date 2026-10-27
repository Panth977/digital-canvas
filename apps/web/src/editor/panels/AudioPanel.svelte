<script lang="ts">
  /** Canva's Audio panel: music and sound effects from Openverse (Jamendo, Freesound, …) and Wikimedia Commons. */
  import type { EditorState } from '../../lib/editor.svelte.ts';
  import BrowsePanel, { type Mode } from './BrowsePanel.svelte';

  let { ed }: { ed: EditorState } = $props();

  const t = (label: string, query = label.toLowerCase()) => ({ label, query });
  const MODES: Mode[] = [
    { id: 'music', label: 'Music', opts: { audio: 'music' }, topics: [t('Upbeat'), t('Happy'), t('Calm'), t('Cinematic'), t('Acoustic'), t('Piano'), t('Electronic'), t('Ambient'), t('Jazz'), t('Rock'), t('Hip hop'), t('Lo-fi', 'lofi'), t('Classical'), t('Corporate')] },
    { id: 'sfx', label: 'Sound effects', opts: { audio: 'sound_effect' }, topics: [t('Whoosh'), t('Applause'), t('Rain'), t('Birds'), t('Click'), t('Laugh'), t('Wind'), t('Ocean', 'waves'), t('Bell'), t('Thunder'), t('Footsteps'), t('Pop'), t('Camera', 'camera shutter'), t('Notification')] },
  ];
</script>

<BrowsePanel {ed} kind="audio" placeholder="Search music and sound effects" searchTestid="audio-search" resultsTestid="audio-results" modes={MODES}
  credits={'Openly licensed music and sounds via <a href="https://openverse.org" target="_blank" rel="noreferrer">Openverse</a> (Jamendo, Freesound, ccMixter…; licences that allow commercial use and changes) and <a href="https://commons.wikimedia.org" target="_blank" rel="noreferrer">Wikimedia Commons</a>. Press play to listen; click a track (or drag it onto the page) to add it to your design\'s timeline. Its credit is kept with the sound.'} />
