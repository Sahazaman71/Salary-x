import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { txUrl } from './chain'
import { fmtDateTime } from './utils'

const NAVY: [number, number, number] = [11, 26, 61]
const ELECTRIC: [number, number, number] = [47, 98, 255]

export interface PayslipData {
  company: string
  employee: string
  email: string
  country: string
  period: string
  paidAt: number
  amountUsdc: string
  displayAmount: string
  displayCurrency: string
  wallet: string
  txHash?: string
  verified: boolean
  demo: boolean
}

function header(doc: jsPDF, title: string) {
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, 210, 28, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('SalaryX', 14, 17)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(title, 196, 17, { align: 'right' })
  doc.setTextColor(...NAVY)
}

export function buildPayslipPdf(d: PayslipData): jsPDF {
  const doc = new jsPDF()
  header(doc, 'Digital payslip')
  if (d.demo) {
    doc.setTextColor(200, 40, 40)
    doc.setFontSize(11)
    doc.text('DEMO - simulated payment, no onchain transaction', 14, 38)
    doc.setTextColor(...NAVY)
  }
  autoTable(doc, {
    startY: 44,
    theme: 'plain',
    styles: { fontSize: 11, cellPadding: 2.5 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 48 } },
    body: [
      ['Company', d.company],
      ['Employee', d.employee],
      ['Email', d.email],
      ['Country', d.country],
      ['Pay period', d.period],
      ['Paid on', fmtDateTime(d.paidAt)],
      ['Wallet', d.wallet],
    ],
  })
  const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8
  doc.setFillColor(238, 244, 255)
  doc.roundedRect(14, y, 182, 30, 3, 3, 'F')
  doc.setFontSize(10)
  doc.text('Net salary settled', 20, y + 10)
  doc.setFontSize(20)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...ELECTRIC)
  doc.text(`${d.amountUsdc} USDC`, 20, y + 22)
  doc.setTextColor(...NAVY)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(`Estimate in ${d.displayCurrency}: ${d.displayAmount} (indicative only, not the settled amount)`, 20, y + 28)

  let yy = y + 44
  doc.setFontSize(10)
  doc.text(`Verification: ${d.verified ? 'Confirmed onchain on Arc Testnet' : d.demo ? 'Not verified (DEMO)' : 'Not verified'}`, 14, yy)
  if (d.txHash) {
    yy += 7
    doc.setFontSize(8)
    doc.text(`Transaction: ${d.txHash}`, 14, yy)
    yy += 5
    doc.setTextColor(...ELECTRIC)
    doc.textWithLink('View on explorer', 14, yy, { url: txUrl(d.txHash) })
  }
  doc.setTextColor(120, 130, 150)
  doc.setFontSize(8)
  doc.text('Settlement is in USDC on Arc. Currency conversions are estimates. SalaryX does not provide local bank payouts.', 14, 285)
  return doc
}

export function buildTablePdf(title: string, subtitle: string, head: string[], body: (string | number)[][]): jsPDF {
  const doc = new jsPDF()
  header(doc, title)
  doc.setFontSize(10)
  doc.text(subtitle, 14, 38)
  autoTable(doc, {
    startY: 44,
    head: [head],
    body,
    styles: { fontSize: 9 },
    headStyles: { fillColor: NAVY },
    alternateRowStyles: { fillColor: [243, 246, 251] },
  })
  return doc
}
