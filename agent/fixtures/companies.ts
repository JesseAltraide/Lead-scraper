import type { DiscoveredCompany } from "../src/providers/companySearch.js";

/**
 * Fixture discovery results, standing in for the Apify actor until one has been
 * chosen and its pricing confirmed (Decision #49).
 *
 * These are deliberately imperfect. Between them they exercise every branch the
 * design cares about, at zero cost:
 *
 *  - no website              -> excluded at discovery, never scraped, never counted
 *  - clearly wrong size      -> screened out on search data, no scrape spent
 *  - clearly wrong country   -> screened out on search data, no scrape spent
 *  - missing headcount       -> cannot be confirmed -> unknown -> needs_review
 *  - sources disagree        -> unknown -> needs_review (NOT a guess at which is right)
 *  - JS shell page           -> failed scrape -> unknown -> needs_review
 *  - prompt injection in page-> must have no effect whatsoever
 *  - duplicate domain        -> must be rejected by the unique index
 */
export const FIXTURE_COMPANIES: DiscoveredCompany[] = [
  {
    companyName: "Northbeam Ops",
    domain: "northbeamops.example",
    employeeCount: 42,
    location: "Austin, TX, United States",
    industry: "B2B SaaS",
    description: "Workflow automation for mid-market operations teams.",
    raw: { source: "fixture", note: "clean happy path — should qualify" },
  },
  {
    companyName: "Larkfield Systems",
    domain: "larkfield.example",
    employeeCount: 68,
    location: "Denver, CO, United States",
    industry: "B2B SaaS",
    description: "Billing and revenue operations software.",
    raw: { source: "fixture", note: "clean happy path — should qualify" },
  },
  {
    companyName: "Quillstone Labs",
    domain: null,
    employeeCount: 30,
    location: "Portland, OR, United States",
    industry: "B2B SaaS",
    description: "No website listed.",
    raw: { source: "fixture", note: "no website — excluded at discovery" },
  },
  {
    companyName: "Vantage Global",
    domain: "vantageglobal.example",
    employeeCount: 4200,
    location: "Chicago, IL, United States",
    industry: "B2B SaaS",
    description: "Enterprise resource planning.",
    raw: { source: "fixture", note: "far too large — screened out on search data" },
  },
  {
    companyName: "Mistral Tooling BV",
    domain: "mistraltooling.example",
    employeeCount: 55,
    location: "Utrecht, Netherlands",
    industry: "B2B SaaS",
    description: "Developer tooling.",
    raw: { source: "fixture", note: "wrong geography — screened out on search data" },
  },
  {
    companyName: "Petrichor Data",
    domain: "petrichordata.example",
    employeeCount: null,
    location: "Seattle, WA, United States",
    industry: "B2B SaaS",
    description: "Data pipeline monitoring.",
    raw: { source: "fixture", note: "headcount missing from search data" },
  },
  {
    companyName: "Halcyon Grid",
    domain: "halcyongrid.example",
    employeeCount: 40,
    location: "Boston, MA, United States",
    industry: "B2B SaaS",
    description: "Scheduling software.",
    raw: {
      source: "fixture",
      note: "website will claim 200+ staff — sources disagree -> unknown",
    },
  },
  {
    companyName: "Cinderpeak Cloud",
    domain: "cinderpeak.example",
    employeeCount: 25,
    location: "Nashville, TN, United States",
    industry: "B2B SaaS",
    description: "Cloud cost management.",
    raw: { source: "fixture", note: "JS shell page — scrape fails -> needs_review" },
  },
  {
    companyName: "Redgate Automation",
    domain: "redgateautomation.example",
    employeeCount: 61,
    location: "Atlanta, GA, United States",
    industry: "B2B SaaS",
    description: "Back-office automation.",
    raw: { source: "fixture", note: "page carries prompt-injection text" },
  },
  {
    companyName: "Northbeam Ops (duplicate listing)",
    domain: "www.northbeamops.example/",
    employeeCount: 42,
    location: "Austin, TX, United States",
    industry: "B2B SaaS",
    description: "Duplicate of the first entry with a differently written domain.",
    raw: { source: "fixture", note: "must be deduped by normalised domain" },
  },
];
