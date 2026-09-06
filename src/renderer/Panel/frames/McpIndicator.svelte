<script lang="ts">
  import { ButtonWindow } from "Common/Buttons";
  import { Mcp } from "Icons";
  import { currentTab, mcpTabs } from "../store";

  let { hoverBgColor, activeBgColor }: { hoverBgColor: string; activeBgColor: string } = $props();

  const count = $derived(mcpTabs.value.length);
  const active = $derived(mcpTabs.value.some((tab) => tab.id === currentTab.value));
  const tooltip = $derived(mcpTabs.value.map((tab) => tab.title).join("\n"));
  const ids = $derived(mcpTabs.value.map((tab) => tab.id).join(","));
  const busy = $derived(mcpTabs.value.some((tab) => tab.busy));

  // The sweep keeps running until the iteration in flight ends, so a short
  // call still shows one full pass instead of a cut-off flash.
  let shimmer = $state(false);
  $effect(() => {
    if (busy) shimmer = true;
  });
  function onSweepIteration() {
    if (!busy) shimmer = false;
  }

  function openMenu() {
    window.figmaApi.send("openMcpMenu");
  }
</script>

{#if count > 0}
  <div
    class="mcp-btn"
    class:mcp-btn--busy={shimmer}
    title={tooltip}
    data-mcp-tabs={ids}
    onanimationiteration={onSweepIteration}
  >
    <ButtonWindow
      padding="0 10px"
      isActive={active}
      {hoverBgColor}
      {activeBgColor}
      onButtonClick={openMenu}
    >
      <Mcp size="16" color="currentColor" />
      <span>{count}</span>
    </ButtonWindow>
  </div>
{/if}

<style>
  .mcp-btn {
    display: flex;
    align-items: center;
  }

  .mcp-btn :global(div[role="button"]) {
    gap: 5px;
    position: relative;
    overflow: hidden;
  }

  .mcp-btn--busy :global(div[role="button"]::after) {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(
      110deg,
      transparent 30%,
      var(--frame-btn-active) 50%,
      transparent 70%
    );
    transform: translateX(-100%);
    animation: mcp-sweep 1.6s ease-in-out infinite;
  }

  @keyframes mcp-sweep {
    to {
      transform: translateX(100%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .mcp-btn--busy :global(div[role="button"]::after) {
      display: none;
    }
  }

  .mcp-btn span {
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    color: currentColor;
  }
</style>
