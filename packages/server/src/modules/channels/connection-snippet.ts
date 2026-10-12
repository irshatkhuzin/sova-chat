/** Public identifiers only. Channel signing secrets must stay on the customer's backend. */
export function connectionSnippet(type: string, publicId: string, serverUrl: string): string {
  const url=serverUrl.replace(/\/+$/, "");
  if(type==='android') {
    const kotlin=(s:string)=>JSON.stringify(s).replace(/\$/g,'\\$');
    return `import chat.sova.sdk.Sova\nimport chat.sova.sdk.SovaConfig\n\n// В Application.onCreate()\nSova.init(\n    context = this,\n    config = SovaConfig(\n        serverUrl = ${kotlin(url)},\n        channelPublicId = ${kotlin(publicId)}\n    )\n)\n\n// Открыть чат из Activity\nSova.openChat(this)`;
  }
  if(type==='web')return `<script src="${url}/widget.js" data-channel-id="${publicId}" async></script>`;
  return "Интеграция этого типа канала пока не реализована.";
}
