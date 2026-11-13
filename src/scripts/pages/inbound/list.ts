/**
 * 入库页 Alpine 组件
 *
 * 上面是这个浏览器建过的入库单，下面是选中的那一张：加行、完成。最下面是「接口返回」。
 * 课上的操作：建单 → 加一行 SKU-003 / A-01-01 / 10 → 完成，再到数据库看 inventory 多了哪一行。
 */
import { inboundApi } from '@/pages/inbound/inbound.api'
import type { InboundOrderVO } from '@/pages/inbound/inbound.model'
import { skusApi } from '@/pages/skus/skus.api'
import type { SkuVO } from '@/pages/skus/skus.model'
import { warehousesApi } from '@/pages/warehouses/warehouses.api'
import type { LocationVO } from '@/pages/warehouses/warehouses.model'
import { recordCall, callTime, type CallResult } from '@/core/ui/callResult'
import { loadOrders, upsertOrder, clearOrders } from '@/core/ui/orderHistory'

const STORE_KEY = 'wms.inboundOrders'

export function inboundPageComponent() {
  return {
    orders: loadOrders<InboundOrderVO>(STORE_KEY),
    currentId: null as number | null,
    skus: [] as SkuVO[],
    locations: [] as LocationVO[],
    form: { skuCode: 'SKU-003', locationCode: 'A-01-01', quantity: 10 },
    calls: [] as CallResult[],
    busy: false,

    get current(): InboundOrderVO | null {
      return this.orders.find((o) => o.id === this.currentId) ?? null
    },

    /** 下拉框里的货品编码 */
    get skuCodes(): string[] {
      return [...new Set(this.skus.map((s) => s.code))]
    },

    async loadOptions() {
      const [skuRes, locRes] = await Promise.all([skusApi.list(), warehousesApi.listLocations()])
      if (skuRes.ok) this.skus = skuRes.data
      if (locRes.ok) this.locations = [...locRes.data.records].sort((a, b) => a.code.localeCompare(b.code))
    },

    /** 接口返回整张单时，更新左边的记录并选中它 */
    keep(order: InboundOrderVO) {
      this.orders = upsertOrder(STORE_KEY, this.orders, order)
      this.currentId = order.id
    },

    async createOrder() {
      this.busy = true
      const res = await inboundApi.create()
      this.calls = recordCall(this.calls, 'POST /inbound-orders', res)
      if (res.ok) this.keep(res.data)
      this.busy = false
    },

    async addLine() {
      if (!this.current) return
      this.busy = true
      const id = this.current.id
      const res = await inboundApi.addLine(id, { ...this.form, quantity: Number(this.form.quantity) })
      this.calls = recordCall(this.calls, `POST /inbound-orders/${id}/lines`, res)
      if (res.ok) this.keep(res.data)
      this.busy = false
    },

    async complete() {
      if (!this.current) return
      this.busy = true
      const id = this.current.id
      const res = await inboundApi.complete(id)
      this.calls = recordCall(this.calls, `POST /inbound-orders/${id}/complete`, res)
      if (res.ok) this.keep(res.data)
      this.busy = false
    },

    /** 同一张单的两次请求先一起发出，分别记录结果；busy 只防误操作，不承担后端并发保护。 */
    async completeTogether() {
      if (!this.current || this.busy) return
      const id = this.current.id
      this.busy = true
      const sentAt = callTime()
      try {
        const results = await Promise.all(
          [1, 2].map((attempt) => inboundApi.complete(id).then((res) => ({ attempt, res, at: callTime() }))),
        )
        results.sort((a, b) => a.at.localeCompare(b.at))
        for (const { attempt, res, at } of results) {
          this.calls = recordCall(this.calls, `POST /inbound-orders/${id}/complete（第${attempt}次，${sentAt} 同时发出）`, res, at)
          if (res.ok) this.keep(res.data)
        }
      } finally {
        this.busy = false
      }
    },

    clearHistory() {
      clearOrders(STORE_KEY)
      this.orders = []
      this.currentId = null
    },

    init() {
      this.currentId = this.orders[0]?.id ?? null
      this.loadOptions()
    },
  }
}
