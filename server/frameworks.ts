// The controls a risk can be linked to (ADR 0049): ISO/IEC 27001:2022 Annex A and the SOC 2 Trust Services Criteria
// (2017, revised points of focus 2022). Each control has its number and a short name; the standards' own text is
// not copied, so read them for what each control asks. `products` are the OpenAsy products that keep evidence for it.

export interface Control {
  id: string;
  title: string;
  group: string;
  products?: string[];
}

export interface Framework {
  id: string;
  name: string;
  short: string;
  controls: Control[];
}

const group = (name: string, rows: Array<[string, string, string[]?]>): Control[] =>
  rows.map(([id, title, products]) => ({ id, title, group: name, ...(products && { products }) }));

const ISO: Control[] = [
  ...group("Organizational", [
    ["5.1", "Policies for information security"],
    ["5.2", "Information security roles and responsibilities"],
    ["5.3", "Segregation of duties", ["identity"]],
    ["5.4", "Management responsibilities"],
    ["5.5", "Contact with authorities"],
    ["5.6", "Contact with special interest groups"],
    ["5.7", "Threat intelligence", ["threat-intel"]],
    ["5.8", "Information security in project management"],
    ["5.9", "Inventory of information and other associated assets", ["infrastructure"]],
    ["5.10", "Acceptable use of information and other associated assets"],
    ["5.11", "Return of assets"],
    ["5.12", "Classification of information"],
    ["5.13", "Labelling of information"],
    ["5.14", "Information transfer"],
    ["5.15", "Access control", ["identity"]],
    ["5.16", "Identity management", ["identity"]],
    ["5.17", "Authentication information", ["identity", "secrets"]],
    ["5.18", "Access rights", ["identity"]],
    ["5.19", "Information security in supplier relationships", ["risk"]],
    ["5.20", "Addressing information security within supplier agreements", ["risk"]],
    ["5.21", "Managing information security in the ICT supply chain", ["supply-chain", "audit"]],
    ["5.22", "Monitoring, review and change management of supplier services", ["risk"]],
    ["5.23", "Information security for use of cloud services", ["posture", "cost"]],
    ["5.24", "Information security incident management planning and preparation", ["incidents"]],
    ["5.25", "Assessment and decision on information security events", ["siem", "incidents"]],
    ["5.26", "Response to information security incidents", ["incidents"]],
    ["5.27", "Learning from information security incidents", ["incidents"]],
    ["5.28", "Collection of evidence", ["incidents", "logs"]],
    ["5.29", "Information security during disruption", ["backups"]],
    ["5.30", "ICT readiness for business continuity", ["backups", "uptime"]],
    ["5.31", "Legal, statutory, regulatory and contractual requirements"],
    ["5.32", "Intellectual property rights"],
    ["5.33", "Protection of records"],
    ["5.34", "Privacy and protection of PII"],
    ["5.35", "Independent review of information security"],
    ["5.36", "Compliance with policies, rules and standards for information security", ["posture"]],
    ["5.37", "Documented operating procedures"],
  ]),
  ...group("People", [
    ["6.1", "Screening"],
    ["6.2", "Terms and conditions of employment"],
    ["6.3", "Information security awareness, education and training"],
    ["6.4", "Disciplinary process"],
    ["6.5", "Responsibilities after termination or change of employment", ["identity"]],
    ["6.6", "Confidentiality or non-disclosure agreements"],
    ["6.7", "Remote working", ["vpn"]],
    ["6.8", "Information security event reporting", ["incidents"]],
  ]),
  ...group("Physical", [
    ["7.1", "Physical security perimeters"],
    ["7.2", "Physical entry"],
    ["7.3", "Securing offices, rooms and facilities"],
    ["7.4", "Physical security monitoring"],
    ["7.5", "Protecting against physical and environmental threats"],
    ["7.6", "Working in secure areas"],
    ["7.7", "Clear desk and clear screen"],
    ["7.8", "Equipment siting and protection"],
    ["7.9", "Security of assets off-premises"],
    ["7.10", "Storage media"],
    ["7.11", "Supporting utilities"],
    ["7.12", "Cabling security"],
    ["7.13", "Equipment maintenance"],
    ["7.14", "Secure disposal or re-use of equipment"],
  ]),
  ...group("Technological", [
    ["8.1", "User endpoint devices"],
    ["8.2", "Privileged access rights", ["identity", "infrastructure"]],
    ["8.3", "Information access restriction", ["identity"]],
    ["8.4", "Access to source code", ["sast"]],
    ["8.5", "Secure authentication", ["identity"]],
    ["8.6", "Capacity management", ["infrastructure", "uptime"]],
    ["8.7", "Protection against malware", ["malware"]],
    ["8.8", "Management of technical vulnerabilities", ["vulnerabilities", "audit", "dast"]],
    ["8.9", "Configuration management", ["posture", "infrastructure"]],
    ["8.10", "Information deletion"],
    ["8.11", "Data masking", ["logs"]],
    ["8.12", "Data leakage prevention", ["secrets"]],
    ["8.13", "Information backup", ["backups"]],
    ["8.14", "Redundancy of information processing facilities", ["uptime"]],
    ["8.15", "Logging", ["logs", "siem"]],
    ["8.16", "Monitoring activities", ["siem", "uptime", "errors"]],
    ["8.17", "Clock synchronization", ["infrastructure"]],
    ["8.18", "Use of privileged utility programs", ["siem"]],
    ["8.19", "Installation of software on operational systems", ["infrastructure"]],
    ["8.20", "Networks security", ["vpn"]],
    ["8.21", "Security of network services", ["certificates", "dast"]],
    ["8.22", "Segregation of networks", ["vpn"]],
    ["8.23", "Web filtering"],
    ["8.24", "Use of cryptography", ["certificates"]],
    ["8.25", "Secure development life cycle", ["sast", "audit"]],
    ["8.26", "Application security requirements"],
    ["8.27", "Secure system architecture and engineering principles"],
    ["8.28", "Secure coding", ["sast", "secrets"]],
    ["8.29", "Security testing in development and acceptance", ["sast", "dast", "audit"]],
    ["8.30", "Outsourced development"],
    ["8.31", "Separation of development, test and production environments"],
    ["8.32", "Change management", ["infrastructure"]],
    ["8.33", "Test information"],
    ["8.34", "Protection of information systems during audit testing", ["dast"]],
  ]),
];

const SOC2: Control[] = [
  ...group("Control environment", [
    ["CC1.1", "Commitment to integrity and ethical values"],
    ["CC1.2", "Independent oversight by the board"],
    ["CC1.3", "Structures, reporting lines and authority"],
    ["CC1.4", "Commitment to competent people"],
    ["CC1.5", "Accountability for internal control"],
  ]),
  ...group("Communication and information", [
    ["CC2.1", "Relevant, quality information"],
    ["CC2.2", "Internal communication of objectives and responsibilities"],
    ["CC2.3", "Communication with external parties"],
  ]),
  ...group("Risk assessment", [
    ["CC3.1", "Objectives clear enough to assess risks against", ["risk"]],
    ["CC3.2", "Identifying and analysing risks", ["risk"]],
    ["CC3.3", "Considering the potential for fraud", ["risk"]],
    ["CC3.4", "Changes that could affect internal control", ["risk"]],
  ]),
  ...group("Monitoring activities", [
    ["CC4.1", "Ongoing and separate evaluations of controls", ["posture"]],
    ["CC4.2", "Communicating control deficiencies", ["posture", "risk"]],
  ]),
  ...group("Control activities", [
    ["CC5.1", "Control activities that reduce risks", ["risk"]],
    ["CC5.2", "General controls over technology"],
    ["CC5.3", "Policies and the procedures that put them in place"],
  ]),
  ...group("Logical and physical access", [
    ["CC6.1", "Logical access security over protected assets", ["identity"]],
    ["CC6.2", "Registering and authorizing new users", ["identity"]],
    ["CC6.3", "Granting, changing and removing access by role", ["identity"]],
    ["CC6.4", "Restricting physical access"],
    ["CC6.5", "Protecting data on assets that are disposed of"],
    ["CC6.6", "Protection against threats from outside the system's boundaries", ["vpn", "dast"]],
    ["CC6.7", "Restricting the transmission and movement of information", ["certificates", "vpn"]],
    ["CC6.8", "Preventing or detecting unauthorized or malicious software", ["malware", "supply-chain"]],
  ]),
  ...group("System operations", [
    ["CC7.1", "Detecting configuration changes and new vulnerabilities", ["vulnerabilities", "posture", "infrastructure"]],
    ["CC7.2", "Monitoring for anomalies that suggest an attack or failure", ["siem", "logs", "uptime"]],
    ["CC7.3", "Evaluating security events", ["siem", "incidents"]],
    ["CC7.4", "Responding to security incidents", ["incidents"]],
    ["CC7.5", "Recovering from security incidents", ["incidents", "backups"]],
  ]),
  ...group("Change management", [["CC8.1", "Authorizing, testing, approving and putting in place changes", ["sast", "audit", "infrastructure"]]]),
  ...group("Risk mitigation", [
    ["CC9.1", "Mitigating the risk of business disruption", ["risk", "backups"]],
    ["CC9.2", "Assessing and managing vendor and business partner risk", ["risk"]],
  ]),
  ...group("Availability", [
    ["A1.1", "Managing capacity to meet objectives", ["infrastructure", "uptime"]],
    ["A1.2", "Environmental protection, backups and recovery infrastructure", ["backups"]],
    ["A1.3", "Testing recovery plans", ["backups"]],
  ]),
  ...group("Confidentiality", [
    ["C1.1", "Identifying and keeping confidential information", ["secrets"]],
    ["C1.2", "Disposing of confidential information"],
  ]),
  ...group("Processing integrity", [
    ["PI1.1", "Information about processing objectives and specifications"],
    ["PI1.2", "Complete and accurate inputs"],
    ["PI1.3", "Complete, accurate and timely processing", ["errors"]],
    ["PI1.4", "Complete, accurate and timely outputs"],
    ["PI1.5", "Storing inputs, items in processing and outputs"],
  ]),
  ...group("Privacy", [
    ["P1.1", "Notice about privacy practices"],
    ["P2.1", "Choice and consent"],
    ["P3.1", "Collecting personal information for the stated objectives"],
    ["P3.2", "Explicit consent for collecting sensitive information"],
    ["P4.1", "Using personal information only for the stated objectives"],
    ["P4.2", "Retaining personal information"],
    ["P4.3", "Disposing of personal information"],
    ["P5.1", "Access by data subjects"],
    ["P5.2", "Correction by data subjects"],
    ["P6.1", "Disclosure to third parties with consent"],
    ["P6.2", "Record of authorized disclosures"],
    ["P6.3", "Record of unauthorized disclosures", ["incidents"]],
    ["P6.4", "Privacy commitments from third parties", ["risk"]],
    ["P6.5", "Third parties reporting unauthorized disclosures", ["risk"]],
    ["P6.6", "Notifying affected data subjects of breaches", ["incidents"]],
    ["P6.7", "Accounting of disclosures to data subjects"],
    ["P7.1", "Quality of personal information"],
    ["P8.1", "Inquiries, complaints and disputes"],
  ]),
];

export const FRAMEWORKS: Framework[] = [
  { id: "iso27001-2022", name: "ISO/IEC 27001:2022 Annex A", short: "ISO 27001", controls: ISO },
  { id: "soc2-2017", name: "SOC 2 Trust Services Criteria (2017, revised 2022)", short: "SOC 2", controls: SOC2 },
];

const index = new Map(FRAMEWORKS.flatMap((f) => f.controls.map((c) => [`${f.id}:${c.id}`, { framework: f, control: c }] as const)));

/** The control a framework and number name, or undefined. */
export const controlOf = (framework: string, id: string) => index.get(`${framework}:${id}`);
