// The hosted apps that sign people in with this account. Used for the "Your apps" list, team exports and the
// data-home move plan. Self-hosters change the addresses with WOS_APP_<ID>_URL.
const base = (idv, url) => process.env[`WOS_APP_${idv.toUpperCase()}_URL`] || url;

export const APPS = [
  { id: 'suite', name: 'wOS', blurb: 'Every app in one place, with your agents', url: base('suite', 'https://app.waronsaas.com'), export: 'hosting.export', mover: 'postgres' },
  { id: 'board', name: 'Board', blurb: 'Tasks your people and agents share', url: base('board', 'https://kanban.waronsaas.com'), export: 'board.export', mover: 'github' },
  { id: 'crm', name: 'CRM', blurb: 'Contacts, deals and follow-ups', url: base('crm', 'https://crm.waronsaas.com'), export: 'crm.export', mover: 'postgres' },
  { id: 'chat', name: 'Chat', blurb: 'Channels for people and agents', url: base('chat', 'https://chat.waronsaas.com'), export: 'chat.export', mover: 'postgres' },
  { id: 'email', name: 'Email', blurb: 'Your inbox, and running wOS by email', url: base('email', 'https://email.waronsaas.com'), export: 'email.export', mover: 'postgres' },
  { id: 'meet', name: 'Meetings', blurb: 'Calls with notes your agents can use', url: base('meet', 'https://meet.waronsaas.com'), export: 'meet.export', mover: 'postgres' },
  { id: 'scanner', name: 'Scanner', blurb: 'See what a site is built on', url: base('scanner', 'https://scan.waronsaas.com'), export: 'scanner.export', mover: 'postgres' },
  { id: 'decks', name: 'Decks', blurb: 'Slides your agents can build', url: base('decks', 'https://decks.waronsaas.com'), export: 'decks.export', mover: 'postgres' },
  { id: 'sheets', name: 'Sheets', blurb: 'Spreadsheets your agents can work in', url: base('sheets', 'https://sheets.waronsaas.com'), export: 'sheets.export', mover: 'postgres' },
];
