/**
 * 对账服务
 * 下载微信支付交易对账单并与本地订单比对，识别金额不一致、本地漏单、本地多单、退款差异。
 * 真实下载链路见 WechatService.downloadTradeBill；比对逻辑与 mock/真实共用。
 * 金额统一以“分”（整数）存储与比较。
 */
const { business } = require('../errors');

// 微信支付 v3 交易对账单表头（列名与顺序，供解析与 mock 复用）
const BILL_HEADER = '交易时间,公众账号ID,商户号,特约商户号,设备号,微信订单号,商户订单号,用户标识,交易类型,交易状态,付款银行,货币种类,应结订单金额,代金券金额,微信退款单号,商户退款单号,退款金额,充值券退款金额,退款类型,退款状态,商品名称,商户数据包,手续费,费率,订单金额,申请退款金额,费率备注';

class ReconciliationService {
  constructor(store, orderManager, wechat) {
    this.store = store;
    this.orders = orderManager;
    this.wechat = wechat;
  }

  /**
   * 执行对账
   * @param date YYYY-MM-DD
   * @param billCsv 可选，注入账单原文用于测试；缺省时调用 wechat.downloadTradeBill(date)
   * @returns {date, summary, matchedPayments, missingInLocal, missingInBill, amountMismatch, refundMismatch, balanced}
   */
  async reconcile(date, billCsv) {
    const d = String(date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw business('对账日期格式应为 YYYY-MM-DD');
    const csv = billCsv !== undefined ? billCsv : await this.wechat.downloadTradeBill(d);
    const rows = this.parseBill(csv);

    const payments = rows.filter(r => r.tradeState === 'SUCCESS' && r.amount > 0);
    const refunds = rows.filter(r => r.refundAmount > 0);

    const matchedPayments = [];
    const missingInLocal = [];
    const amountMismatch = [];
    for (const p of payments) {
      const local = this.store.find('orders', o => o.orderNo === p.orderNo)[0];
      if (!local) { missingInLocal.push({ orderNo: p.orderNo, amount: p.amount }); continue; }
      const localAmount = Math.round(Number(local.payAmount) || 0);
      if (localAmount !== p.amount) {
        amountMismatch.push({ orderNo: p.orderNo, local: localAmount, bill: p.amount });
      } else {
        matchedPayments.push({ orderNo: p.orderNo, transactionId: p.transactionId, amount: p.amount });
      }
    }

    // 本地已支付订单中，支付日期与对账日一致但账单缺失的（可能账单延迟，也可能是漏单）
    const paidLocal = this.store.find('orders', o => o.paidAt && o.paidAt.slice(0, 10) === d);
    const billOrderNos = new Set(payments.map(p => p.orderNo));
    const missingInBill = paidLocal
      .filter(o => !billOrderNos.has(o.orderNo))
      .map(o => ({ orderNo: o.orderNo, amount: Math.round(Number(o.payAmount) || 0) }));

    // 退款比对：按订单汇总账单退款额 vs 本地累计退款额
    const refundByOrder = new Map();
    for (const r of refunds) {
      refundByOrder.set(r.orderNo, (refundByOrder.get(r.orderNo) || 0) + r.refundAmount);
    }
    const refundMismatch = [];
    for (const [orderNo, billRefund] of refundByOrder) {
      const local = this.store.find('orders', o => o.orderNo === orderNo)[0];
      const localRefund = local ? Math.round(Number(local.refundedAmount) || 0) : 0;
      if (!local || localRefund !== billRefund) {
        refundMismatch.push({ orderNo, billRefund, localRefund, localExists: !!local });
      }
    }

    const balanced = missingInLocal.length === 0 && missingInBill.length === 0 &&
      amountMismatch.length === 0 && refundMismatch.length === 0;

    return {
      date: d,
      summary: {
        billRows: rows.length,
        payments: payments.length,
        refunds: refunds.length,
        matchedPayments: matchedPayments.length,
        missingInLocal: missingInLocal.length,
        missingInBill: missingInBill.length,
        amountMismatch: amountMismatch.length,
        refundMismatch: refundMismatch.length
      },
      matchedPayments,
      missingInLocal,
      missingInBill,
      amountMismatch,
      refundMismatch,
      balanced
    };
  }

  /** 解析微信交易对账单 CSV（兼容 BOM、CRLF、尾部汇总行、空行） */
  parseBill(csv) {
    const text = String(csv || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) throw business('对账单为空');
    const header = lines[0].split(',').map(s => s.trim());
    const idx = name => header.indexOf(name);
    const iOrderNo = idx('商户订单号');
    const iTxId = idx('微信订单号');
    const iState = idx('交易状态');
    const iAmount = idx('订单金额');
    const iRefundAmount = idx('退款金额');
    if (iOrderNo < 0 || iAmount < 0) throw business('对账单缺少必要列（商户订单号/订单金额）');

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(',');
      if (cells.length < header.length) continue; // 汇总行/格式异常
      const orderNo = (cells[iOrderNo] || '').trim();
      if (!orderNo || orderNo.startsWith('总')) continue;
      rows.push({
        orderNo,
        transactionId: iTxId >= 0 ? (cells[iTxId] || '').trim() : '',
        tradeState: iState >= 0 ? (cells[iState] || '').trim() : '',
        amount: this._yuanToCent(cells[iAmount]),
        refundAmount: iRefundAmount >= 0 ? this._yuanToCent(cells[iRefundAmount]) : 0
      });
    }
    return rows;
  }

  /** 金额：元(字符串) -> 分(整数) */
  _yuanToCent(v) {
    const n = parseFloat(String(v || '0').replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : Math.round(n * 100);
  }
}

ReconciliationService.BILL_HEADER = BILL_HEADER;

module.exports = ReconciliationService;