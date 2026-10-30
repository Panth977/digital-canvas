<script lang="ts">
  import type { EditorState } from '../lib/editor.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import UploadsPanel from './panels/UploadsPanel.svelte';
  import AIPanel from './panels/AIPanel.svelte';
  import TemplatesPanel from './panels/TemplatesPanel.svelte';
  import BrandPanel from './panels/BrandPanel.svelte';
  import ToolsPanel from './panels/ToolsPanel.svelte';
  import ProjectsPanel from './panels/ProjectsPanel.svelte';
  import AppsPanel from './panels/AppsPanel.svelte';
  import ElementsPanel from './panels/ElementsPanel.svelte';
  import TextPanel from './panels/TextPanel.svelte';
  import PhotosPanel from './panels/PhotosPanel.svelte';
  import VideosPanel from './panels/VideosPanel.svelte';
  import AudioPanel from './panels/AudioPanel.svelte';
  import MockupsPanel from './panels/MockupsPanel.svelte';

  /** The rail sections' contents: the desktop side panel and the phone's bottom sheet both show them. */
  let { ed }: { ed: EditorState } = $props();
</script>

{#if ui.panel === 'elements'}
  <ElementsPanel {ed} />
{:else if ui.panel === 'photos'}
  <PhotosPanel {ed} />
{:else if ui.panel === 'videos'}
  <VideosPanel {ed} />
{:else if ui.panel === 'sounds'}
  <AudioPanel {ed} />
{:else if ui.panel === 'draw'}
  <ToolsPanel {ed} />
{:else if ui.panel === 'ai'}
  <AIPanel {ed} />
{:else if ui.panel === 'templates'}
  <TemplatesPanel {ed} />
{:else if ui.panel === 'brand'}
  <BrandPanel {ed} />
{:else if ui.panel === 'projects'}
  <ProjectsPanel {ed} />
{:else if ui.panel === 'apps'}
  <AppsPanel {ed} />
{:else if ui.panel === 'text'}
  <TextPanel {ed} />
{:else if ui.panel === 'mockups'}
  <MockupsPanel {ed} />
{:else if ui.panel === 'uploads'}
  <UploadsPanel {ed} />
{/if}
