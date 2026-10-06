// 数据层冒烟：用内存 localStorage 驱动迁移/管线/结算/遗留逻辑，验证关键口径。
import { build } from 'esbuild'
import { writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const harness = `
import { listRows, readMigrationLog } from '@/data/local-store'
import { listPipelines, pipelineOptions, createPipeline, moveOutPipeline, reportPipelineIssue } from '@/api/pipeline-service'
import { listFeeSettlements, feeStats } from '@/api/fee-service'
import { listIssues, openIssueCount, loadPipelineView, savePipelineView, listLedgerSync } from '@/data/collab-store'

let pass = 0, fail = 0
function assert(name, cond, extra='') {
  if (cond) { pass++; console.log('  PASS', name) }
  else { fail++; console.log('  FAIL', name, extra) }
}

// 1. 迁移（首次读取会触发播种与迁移）
const all0 = listRows('pipeline')
const log = readMigrationLog()[0]
const all = all0
assert('迁移后 19 条去重为 18 条', all.length === 18, 'actual=' + all.length)
assert('剔除 1 条重复登记', log.removedDuplicates.length === 1)
const dup = log.removedDuplicates[0]
assert('重复编号 PIPE-2025-001 保留最早 #7 剔除 #19',
  dup.管线编号 === 'PIPE-2025-001' && dup.keptId === 7 && dup.droppedId === 19, JSON.stringify(dup))
assert('回填 2 条缺入廊日期（待登记的 #18 不回填）', log.backfilledEntryDates.length === 2, JSON.stringify(log.backfilledEntryDates.map(r=>r.id)))
const id7 = all.find(r => r.id === 7)
const id13 = all.find(r => r.id === 13)
assert('#7 按电力舱C段最早月 2024-09 顺补为 2024-10-01', id7['入廊日期'] === '2024-10-01', id7['入廊日期'])
assert('#13 按综合舱A段最早月 2024-02 顺补为 2024-03-01', id13['入廊日期'] === '2024-03-01', id13['入廊日期'])
assert('回填出处写进备注', String(id7['备注']).includes('迁移补录') && String(id7['备注']).includes('电力舱C段'))
assert('按月份分批', log.batches.length >= 5, 'batches=' + log.batches.length)
assert('既有结论全部保留（18 条）', log.preservedConclusions === 18)

// 2. 过滤 / 排序 / 迁出收起
const active = listPipelines({}, { page: 1, size: 100 })
assert('默认收起已迁出：14 条', active.total === 14, 'total=' + active.total)
const idsAsc = active.items.map(r => Number(r.id))
assert('过滤后仍按原次序（id 升序）', idsAsc.every((v,i)=> i===0 || v > idsAsc[i-1]))
const withMoved = listPipelines({}, { includeMovedOut: true, size: 100 })
assert('含迁出 18 条', withMoved.total === 18)
const byOwner = listPipelines({ 权属单位: '市供电公司' }, { size: 100 })
assert('按权属单位收窄（供电，在用）=3', byOwner.total === 3, 'total=' + byOwner.total)
const byOwnerAll = listPipelines({ 权属单位: '市供电公司' }, { includeMovedOut: true, size: 100 })
assert('按权属单位收窄（供电，含迁出）=4', byOwnerAll.total === 4)
const byChamber = listPipelines({ 所属舱室: '燃气舱B段' }, { size: 100 })
assert('按舱室收窄（在用，B段迁出的收起）=2', byChamber.total === 2, 'total=' + byChamber.total)
const byType = listPipelines({ 管线类型: '热力' }, { size: 100 })
assert('按类型收窄（热力，在用）=3', byType.total === 3, 'total=' + byType.total)
assert('三条件可叠加', listPipelines({ 权属单位:'市水务集团', 所属舱室:'综合舱A段', 管线类型:'给水' }, {includeMovedOut:true, size:100}).total === 2)
assert('筛选项来自台账', pipelineOptions('管线类型').includes('燃气'))

// 3. 分页与总数一致
const p1 = listPipelines({}, { page: 1, size: 8 })
const p2 = listPipelines({}, { page: 2, size: 8 })
assert('每页 8 条', p1.items.length === 8 && p2.items.length === 6)
assert('总条数 = 各页之和', p1.total === 14 && p1.items.length + p2.items.length === p1.total)

// 4. 登记：幂等 + 编号去重
const payload = { 管线编号:'PIPE-2026-009', 所属舱室:'综合舱A段', 管线类型:'电力', 权属单位:'市供电公司', 入廊日期:'2026-10-06', 设计容量:'x', 对接联系人:'y' }
const r1 = createPipeline({ token:'T1', ...payload })
assert('首次登记落库', r1.ok, r1.message)
const r2 = createPipeline({ token:'T1', ...payload })
assert('同一笔重复提交整笔退回', !r2.ok && r2.message.includes('重复提交'))
const before = listRows('pipeline').length
const r3 = createPipeline({ token:'T2', ...payload })
const after = listRows('pipeline').length
assert('同管线编号重复登记整笔退回且不落库', !r3.ok && before === after, r3.message)
const r4 = createPipeline({ token:'T3', ...{...payload, 管线编号:''} })
assert('编号为空拒绝', !r4.ok)

// 5. 迁出联动
const id1 = listRows('pipeline').find(r => r['管线编号']==='PIPE-2024-001')
const m1 = moveOutPipeline(Number(id1.id))
assert('办理迁出成功并停计提示', m1.ok && m1.message.includes('停计费'), m1.message)
const movedRow = listRows('pipeline').find(r => r.id === id1.id)
assert('台账状态=已迁出且记录迁出日期', movedRow.status==='已迁出' && movedRow['迁出日期']==='2026-10-06')
const activeAgain = listPipelines({}, {size:100})
assert('迁出后从在用结果收起：登记新增1条后再迁出，仍为14', activeAgain.total === 14, 'total='+activeAgain.total)
const fee = listFeeSettlements()
assert('结算单条数=台账条数=19', fee.length === listRows('pipeline').length && fee.length === 19, 'fee='+fee.length)
const feeRow = fee.find(f => f.pipelineNo==='PIPE-2024-001')
assert('结算侧可见迁出', feeRow.pipelineStatus==='已迁出' && feeRow.moveOutDate==='2026-10-06')
assert('入廊费结清、服务费新口径停计', feeRow.entryFeeStatus.includes('结清') && feeRow.serviceFeeStatus.includes('服务费已停计'), feeRow.serviceFeeStatus)
assert('标注新口径', feeRow.ruleScope.includes('新口径'))
const oldFee = fee.find(f => f.pipelineNo==='PIPE-2024-005')
assert('老迁出沿用历史结论', oldFee.ruleScope.includes('老口径') && oldFee.serviceFeeStatus.includes('历史停计'))
const st = feeStats()
assert('统计：计费中 14 / 新停计 2（种子1条+新迁出1条）/ 历史 3',
  st.billing===14 && st.stopped===2 && st.historical===3, JSON.stringify(st))

// 6. 问题上报同源
const rr = reportPipelineIssue(Number(id1.id), '舱室支架锈蚀')
assert('管线页上报问题成功', rr.ok, rr.message)
assert('遗留清单收到', listIssues().some(i=>i.source==='入廊管线' && i.content==='舱室支架锈蚀'))
assert('管线入口待处理数=1', openIssueCount('入廊管线')===1)
assert('值班侧全量待处理=1（两处同源同数）', openIssueCount()===1)
assert('同步动态含登记/迁出/问题三类',
  ['管线登记','管线迁出','问题上报'].every(k => listLedgerSync().some(s=>s.kind===k)))

// 7. 视图状态
savePipelineView({ filters:{权属单位:'市供电公司',所属舱室:'',管线类型:''}, includeMovedOut:true, page:2, focusId:6 })
const v = loadPipelineView()
assert('视图状态持久化恢复', v.filters.权属单位==='市供电公司' && v.includeMovedOut && v.page===2 && v.focusId===6)

console.log('\\nRESULT pass=' + pass + ' fail=' + fail)
if (fail) process.exit(1)
`

mkdirSync('node_modules/.smoke', { recursive: true })
writeFileSync('node_modules/.smoke/harness.ts', harness)

await build({
  entryPoints: ['node_modules/.smoke/harness.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: 'node_modules/.smoke/out.mjs',
  plugins: [
    {
      name: 'alias',
      setup(b) {
        b.onResolve({ filter: /^@\// }, (args) => {
          const base = new URL(args.path.slice(2), pathToFileURL(process.cwd() + '/src/')).pathname
          return { path: /\.[a-z]+$/.test(base) ? base : `${base}.ts` }
        })
      },
    },
  ],
})

// 注入内存 localStorage / window
const mem = new Map()
const storage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
}
globalThis.localStorage = storage
globalThis.window = globalThis
await import(pathToFileURL(process.cwd() + '/node_modules/.smoke/out.mjs').href)
