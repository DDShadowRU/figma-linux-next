<script lang="ts">
  let { size = "16", color = "var(--fg-header)" } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path
    fill={color}
    d="M5 1.5h2v4H5zM9 1.5h2v4H9zM3 5.5h10v2.5a5 5 0 0 1-5 5 5 5 0 0 1-5-5V5.5zM7 12.5h2V15H7z"
  />
</svg>
