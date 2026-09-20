const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];

const menuButton = $('#menuButton');
const mobileNav = $('#mobileNav');
menuButton?.addEventListener('click', () => mobileNav.classList.toggle('open'));
$$('#mobileNav a').forEach(a => a.addEventListener('click', () => mobileNav.classList.remove('open')));

const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add('visible'); });
},{threshold:.08,rootMargin:'0px 0px -30px 0px'});
$$('.reveal').forEach(el => observer.observe(el));

const searchOverlay = $('#searchOverlay');
const searchInput = $('#searchInput');
const searchResults = $('#searchResults');
const pages = [
  {title:'核心功能', desc:'项目包、HTML 原型、PRD、评审、本地 MCP 与局域网分享', href:'#capabilities'},
  {title:'工作流', desc:'导入项目、浏览原型、对照 PRD、导出 AI 上下文', href:'#workflow'},
  {title:'AI 协作', desc:'Codex、Claude、本地 MCP 与结构化项目上下文', href:'#ai'},
  {title:'技术栈', desc:'React 19、Ant Design 6、TypeScript、Vite 6', href:'#stack'},
  {title:'快速开始', desc:'克隆仓库并启动本地开发环境', href:'#start'}
];
function renderResults(q=''){
  const query=q.trim().toLowerCase();
  const items=query ? pages.filter(x => `${x.title}${x.desc}`.toLowerCase().includes(query)) : pages;
  searchResults.innerHTML = items.length ? items.map(x=>`<a class="search-item" href="${x.href}"><b>${x.title}</b><small>${x.desc}</small></a>`).join('') : '<p>没有找到相关内容。</p>';
  $$('.search-item',searchResults).forEach(a=>a.addEventListener('click',closeSearch));
}
function openSearch(){searchOverlay.hidden=false;renderResults();setTimeout(()=>searchInput.focus(),10)}
function closeSearch(){searchOverlay.hidden=true;searchInput.value=''}
$('#openSearch')?.addEventListener('click',openSearch);
$('#closeSearch')?.addEventListener('click',closeSearch);
searchOverlay?.addEventListener('click',e=>{if(e.target===searchOverlay)closeSearch()});
searchInput?.addEventListener('input',e=>renderResults(e.target.value));
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openSearch()}if(e.key==='Escape'&&!searchOverlay.hidden)closeSearch()});

$('#copyCommand')?.addEventListener('click', async e => {
  const text='git clone https://github.com/Xiao0ozZ/Product-Experience-Center.git';
  try{await navigator.clipboard.writeText(text);e.currentTarget.textContent='已复制';setTimeout(()=>e.currentTarget.textContent='复制',1200)}catch{e.currentTarget.textContent='请手动复制'}
});
