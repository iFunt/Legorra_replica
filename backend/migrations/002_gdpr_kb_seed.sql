-- Seed data for the GDPR knowledge base (public.gdpr_kb).
--
-- These are short, original reference summaries written to ground the
-- claim valuation / drafting / judge prompts (backend/src/lib/claims/*).
-- They are NOT verbatim reproductions of statutes or judgments, and figures
-- (fine amounts, dates) are stated as publicly reported and may need
-- re-verification against the primary source (legislation.gov.uk,
-- ico.org.uk, bailii.org) before being relied on in an actual claim. The
-- app surfaces this caveat in the UI wherever gdpr_kb content is shown.
--
-- Safe to re-run: guarded by a check on title to avoid duplicate inserts.

insert into public.gdpr_kb (category, title, citation, summary, full_text, tags, jurisdiction)
select * from (values
  -- ---------------------------------------------------------------------
  -- Statutes
  -- ---------------------------------------------------------------------
  ('statute', 'Lawfulness, fairness and transparency', 'UK GDPR Art. 5(1)(a)',
   'Personal data must be processed lawfully, fairly, and transparently in relation to the data subject.',
   'Article 5(1)(a) is the foundational principle underpinning most GDPR complaints: a company that processes data without a valid Article 6 basis, or misleads a data subject about how their data is used, is in breach of this principle regardless of which more specific article also applies.',
   array['principles','lawfulness','transparency'], 'UK'),

  ('statute', 'Purpose limitation', 'UK GDPR Art. 5(1)(b)',
   'Personal data collected for specified, explicit, legitimate purposes must not be further processed in a manner incompatible with those purposes.',
   'Relevant where a company uses data collected for one purpose (e.g. account administration) for an unrelated purpose (e.g. marketing or profiling) without a compatible basis or fresh consent.',
   array['principles','purpose-limitation'], 'UK'),

  ('statute', 'Data minimisation', 'UK GDPR Art. 5(1)(c)',
   'Personal data must be adequate, relevant, and limited to what is necessary for the purposes for which it is processed.',
   null, array['principles','minimisation'], 'UK'),

  ('statute', 'Storage limitation', 'UK GDPR Art. 5(1)(e)',
   'Personal data must not be kept in identifiable form for longer than necessary for the purposes for which it is processed.',
   'Common breach ground where a company retains former customers'' data years after the relationship ended with no retention policy applied.',
   array['principles','retention'], 'UK'),

  ('statute', 'Transparent information and modalities', 'UK GDPR Art. 12',
   'Controllers must provide information to data subjects in a concise, transparent, intelligible and easily accessible form, and must respond to data subject requests (including Art. 15 access requests) without undue delay and within one month, extendable by two further months for complex requests with notice to the data subject.',
   'The one-month (statutory) deadline in Art. 12(3) is the key trigger for DSAR-lateness claims. Failure to respond at all, a substantively incomplete response, or an unexplained extension are all breaches of Art. 12, distinct from the substantive Art. 15 breach of not providing the data itself.',
   array['dsar','deadline','transparency'], 'UK'),

  ('statute', 'Right of access by the data subject', 'UK GDPR Art. 15',
   'A data subject has the right to obtain confirmation of whether their personal data is being processed, access to that data, and specified information about the processing (purposes, recipients, retention period, source of data, existence of automated decision-making).',
   'The most commonly invoked right in DSAR-related claims. A response that provides some documents but omits categories of data, recipients, or retention information is an incomplete response to an Art. 15 request, not full compliance.',
   array['dsar','right-of-access'], 'UK'),

  ('statute', 'Right to erasure ("right to be forgotten")', 'UK GDPR Art. 17',
   'A data subject can require erasure of personal data without undue delay where, among other grounds, the data is no longer necessary, consent is withdrawn, or the data subject objects and there are no overriding legitimate grounds.',
   null, array['erasure','right-to-be-forgotten'], 'UK'),

  ('statute', 'Right to object', 'UK GDPR Art. 21',
   'A data subject may object to processing based on legitimate interests or carried out for direct marketing at any time; for direct marketing, processing must stop immediately upon objection with no balancing test.',
   'Continued marketing communications after an explicit objection/opt-out is a clean, easily evidenced Art. 21(3) breach and a common source of distress claims (repeated unwanted contact).',
   array['marketing','objection'], 'UK'),

  ('statute', 'Notification of a personal data breach to the supervisory authority', 'UK GDPR Art. 33',
   'Controllers must notify the ICO of a personal data breach within 72 hours of becoming aware of it, unless the breach is unlikely to result in a risk to individuals.',
   null, array['breach','notification','ico'], 'UK'),

  ('statute', 'Communication of a personal data breach to the data subject', 'UK GDPR Art. 34',
   'Where a breach is likely to result in a high risk to individuals'' rights and freedoms, the controller must communicate the breach to affected data subjects without undue delay, describing the nature of the breach and measures taken.',
   'Failure to notify affected individuals promptly (or at all) compounds distress once they discover the breach independently, and is itself a separate ground of complaint.',
   array['breach','notification'], 'UK'),

  ('statute', 'Right to compensation for material or non-material damage', 'Data Protection Act 2018, s.168 / UK GDPR Art. 82',
   'A person who has suffered material damage (financial loss) or non-material damage (distress) as a result of an infringement of the UK GDPR has the right to receive compensation from the controller or processor.',
   'Art. 82 is the statutory basis for pure "distress" claims with no financial loss — the claimant does not need to prove a quantifiable loss, only that the infringement caused them distress. This is the central legal hook for the platform''s claim-value analysis.',
   array['compensation','distress','article-82'], 'UK'),

  ('statute', 'Complaints to the Commissioner', 'Data Protection Act 2018, s.165 / UK GDPR Art. 77',
   'A data subject has the right to lodge a complaint with the ICO if they consider that the processing of personal data relating to them infringes the UK GDPR.',
   'An ICO complaint is a low-cost parallel/precursor track to a compensation claim — it does not award the data subject compensation directly, but a resulting ICO finding or enforcement action strengthens the evidential basis for a later Art. 82 claim.',
   array['ico','complaint'], 'UK'),

  ('statute', 'Privacy and Electronic Communications Regulations 2003 (PECR)', 'PECR 2003 (as amended)',
   'Regulates unsolicited direct marketing by electronic means (email, SMS, calls); marketing to individuals generally requires prior consent (soft opt-in exceptions apply for existing customers).',
   'Frequently breached alongside UK GDPR Art. 21 in "unwanted marketing" complaints — PECR breaches are also independently enforceable by the ICO with fines up to £500,000 under the pre-2018 DPA regime and now via the UK GDPR-aligned framework.',
   array['marketing','pecr'], 'UK'),

  -- ---------------------------------------------------------------------
  -- Case law
  -- ---------------------------------------------------------------------
  ('case_law', 'Vidal-Hall v Google Inc', '[2015] EWCA Civ 311',
   'Court of Appeal held that "damage" under the (then) Data Protection Act 1998 includes distress alone, without requiring accompanying pecuniary loss, opening the door to standalone distress claims.',
   'Landmark authority establishing that a claimant need not show financial loss to recover compensation for a data protection breach — distress alone suffices. Still commonly cited as the foundational case for non-material-damage claims, though largely superseded in scope by the GDPR/DPA 2018 Art. 82 regime and by Lloyd v Google on class-representation questions.',
   array['distress','compensation','precedent'], 'UK'),

  ('case_law', 'Lloyd v Google LLC', '[2021] UKSC 50',
   'Supreme Court held that a representative "opt-out" class action for a fixed sum of damages could not succeed where individual claimants'' circumstances (and any resulting damage) differed, and that "loss of control" of data alone, without proof of financial loss or distress, was not compensable damage under the DPA 1998.',
   'Important limiting authority: claims must still be tied to a particular claimant''s actual, evidenced distress or loss — generic "loss of control of data" pleaded in the abstract, without individual evidence, will not succeed. Reinforces the platform''s emphasis on gathering the customer''s specific, evidenced distress narrative rather than templated boilerplate.',
   array['class-action','loss-of-control','precedent'], 'UK'),

  ('case_law', 'Rolfe v Veale Wasbrough Vizards LLP', '[2021] EWHC 2809 (QB)',
   'High Court struck out/summarily dismissed a low-value data breach claim (misdirected email containing limited personal data) as trivial, applying a de minimis threshold below which Art. 82 compensation is not available.',
   'Key caution for claim valuation: a single, promptly-contained, low-severity incident with no evidence of meaningful distress (e.g. one misdirected email opened by a professional recipient bound by confidentiality) may fall below the compensable threshold. The platform''s valuation step should flag low-severity, low-evidence claims rather than inflate them.',
   array['de-minimis','low-value','precedent'], 'UK'),

  ('case_law', 'Warren v DSG Retail Ltd', '[2021] EWHC 2168 (QB)',
   'High Court struck out claims framed in tort (negligence, breach of confidence) as duplicative where the same facts were properly a DPA/UK GDPR claim, and emphasised that a data breach alone (e.g. a cyber-attack by a third party) does not automatically mean the controller breached its own obligations without further particularised failure.',
   'Relevant drafting caution: claims should plead the specific statutory breach (e.g. inadequate security measures under Art. 5(1)(f)/Art. 32) rather than relying on the breach event itself as automatic proof of fault, and should avoid piling on overlapping causes of action.',
   array['pleading','causation','precedent'], 'UK'),

  ('case_law', 'TLT & Others v Secretary of State for the Home Department', '[2016] EWHC 2217 (QB)',
   'High Court awarded damages for distress (including for family members) following the accidental online publication of an asylum-seeker database, with awards reflecting the sensitivity of the data and real fear for personal safety.',
   'Illustrates that awards scale substantially with the sensitivity of the data category (e.g. immigration/asylum status, safety implications) and genuine, specific fear/distress evidenced by the claimant, rather than a flat tariff per breach.',
   array['sensitive-data','quantum','precedent'], 'UK'),

  ('case_law', 'Various Claimants v WM Morrisons Supermarkets plc', '[2020] UKSC 12',
   'Supreme Court held an employer was not vicariously liable for a rogue employee''s deliberate, unauthorised leak of colleagues'' payroll data, where the employee acted for personal reasons unconnected to his role.',
   'Relevant where a breach was caused by a malicious insider rather than the controller''s own systemic failure — vicarious liability is not automatic and the claim should instead focus on the controller''s own security/organisational failures (Art. 5(1)(f)/Art. 32) that allowed the insider act to occur or go undetected.',
   array['vicarious-liability','insider-threat','precedent'], 'UK'),

  ('case_law', 'Farley v Paymaster (1836) Ltd (t/a Equiniti)', '[2024] EWHC 383 (KB)',
   'High Court considered a large group of low-value claims arising from pension statements sent to wrong addresses, awarding modest sums per claimant reflecting brief, non-serious distress rather than the higher tariffs seen in more sensitive-data cases.',
   'A useful comparator for "misdirected standard correspondence" claims (e.g. account statements, not special category data) — supports conservative, evidence-led valuation rather than assuming a high award by default.',
   array['misdirected-mail','quantum','precedent'], 'UK'),

  ('case_law', 'Halliday v Creation Consumer Finance Ltd', '[2013] EWCA Civ 333',
   'Court of Appeal upheld a modest award (then under the DPA 1998) for distress caused by a lender wrongly registering a default with credit reference agencies, noting the award should be "not extravagant" but must properly compensate real distress.',
   'Frequently cited comparator for financial/credit-file-related distress claims (e.g. incorrect adverse credit markers), supporting modest-but-real compensation rather than nominal or excessive sums.',
   array['credit-file','quantum','precedent'], 'UK'),

  -- ---------------------------------------------------------------------
  -- ICO enforcement precedents
  -- ---------------------------------------------------------------------
  ('ico_case', 'British Airways plc — 2018 customer data breach', 'ICO Monetary Penalty Notice, October 2020',
   'ICO fined British Airways £20m (reduced from an initial notice of intent of £183.39m) after a 2018 cyber-attack diverted customer traffic to a fraudulent site, compromising personal and payment data of around 400,000 customers, citing inadequate security measures.',
   'Useful precedent for claims involving payment-card/financial data breaches caused by inadequate technical security (Art. 32) — the scale of the ICO fine reflects the sensitivity of financial data and the number of affected individuals, both relevant to comparator reasoning even though the fine itself is separate from individual Art. 82 compensation.',
   array['security-breach','financial-data','fine'], 'UK'),

  ('ico_case', 'Marriott International Inc — Starwood guest reservation breach', 'ICO Monetary Penalty Notice, October 2020',
   'ICO fined Marriott £18.4m (reduced from £99.2m notice of intent) over a breach in the Starwood guest reservation database (compromised before acquisition, undetected for years) exposing names, contact details, and in some cases passport numbers.',
   'Relevant comparator where a breach involved identity-document-level data (e.g. passport numbers) and a long undetected dwell time — both aggravating factors for individual distress claims (identity theft risk, "how long has my data been exposed" uncertainty).',
   array['security-breach','identity-data','fine'], 'UK'),

  ('ico_case', 'Clearview AI Inc', 'ICO Monetary Penalty Notice, May 2022 (later overturned on jurisdictional grounds, EA/2022/0129, Oct 2023)',
   'ICO fined Clearview AI £7.5m for scraping images from the internet and social media to build a global facial-recognition database without a lawful basis or adequate transparency; the fine was later quashed on appeal on jurisdictional (not merits) grounds.',
   'Illustrates ICO''s approach to unlawful large-scale biometric/facial-recognition data collection; note the appeal outcome turned on jurisdiction (law enforcement/immigration exemption argument), not on whether the underlying processing was lawful, so the substantive reasoning remains a useful reference for biometric-data complaints against UK-based controllers.',
   array['biometric-data','facial-recognition','fine'], 'UK'),

  ('ico_case', 'DSG Retail Limited (Dixons Carphone)', 'ICO Monetary Penalty Notice, January 2020',
   'ICO fined DSG Retail £500,000 (the maximum under the pre-GDPR DPA 1998 regime) after malware on point-of-sale terminals compromised payment card and personal data of millions of customers between 2017-2018, citing systemic security failures.',
   'Relevant where the incident straddles the pre-2018 regime; still a strong comparator for point-of-sale/payment-terminal security failures affecting large customer volumes.',
   array['security-breach','payment-data','fine'], 'UK'),

  ('ico_case', '56 Dean Street Clinic (Chelsea and Westminster Hospital NHS Foundation Trust)', 'ICO Monetary Penalty Notice, May 2018',
   'ICO fined the Trust £180,000 after an HIV-clinic newsletter email exposed the names and email addresses of nearly 800 patients to each other by using "To" instead of "Bcc", inadvertently disclosing patients'' HIV status.',
   'Strong precedent for special-category (health) data distress claims — the sensitivity of the disclosed information (HIV status) drove a materially higher fine and is directly analogous to any claim involving inadvertent disclosure of health, sexual orientation, or other special category data to unintended recipients.',
   array['special-category-data','health-data','misdirected-communication','fine'], 'UK'),

  ('ico_case', 'Easylife Limited', 'ICO Monetary Penalty Notice, October 2022',
   'ICO fined Easylife £1.35m for using customers'' purchase history to profile likely health conditions and target them with health-related product marketing, without a lawful basis for processing special category (inferred health) data, plus a further PECR fine for unlawful marketing calls.',
   'Directly relevant to claims involving covert profiling and unsolicited marketing based on inferred sensitive characteristics — a strong comparator for distress caused by realising a company inferred and acted on sensitive personal information without consent.',
   array['profiling','special-category-data','marketing','fine'], 'UK'),

  ('ico_case', 'Tuckers Solicitors LLP', 'ICO Monetary Penalty Notice, March 2022',
   'ICO fined the law firm £98,000 after a ransomware attack exposed court-bundle documents including sensitive case material, citing inadequate security patching and multi-factor authentication.',
   'Relevant comparator where a professional-services controller''s inadequate basic security hygiene (unpatched systems, no MFA) led to exposure of sensitive case/client data — useful for claims against professional firms with a duty of confidentiality.',
   array['security-breach','ransomware','professional-services','fine'], 'UK'),

  ('ico_case', 'American Express Services Europe Limited', 'ICO Monetary Penalty Notice, August 2021',
   'ICO fined Amex £90,000 for sending over 4 million marketing emails to customers who had not given valid consent, wrongly categorising them as "servicing" rather than marketing communications.',
   'Useful precedent for claims where a company recharacterises marketing as "service" communications to avoid opt-out obligations — a common and easily evidenced (via inbox records) breach pattern.',
   array['marketing','pecr','fine'], 'UK'),

  ('ico_case', 'Interserve Group Limited', 'ICO Monetary Penalty Notice, October 2022',
   'ICO fined Interserve £4.4m after a phishing email led to a cyber-attack compromising the personal data (including special category data) of around 113,000 employees, citing outdated software, insufficient staff training, and inadequate risk assessment.',
   'Relevant comparator for employee (rather than customer) data breaches and for claims emphasising a controller''s failure to run basic organisational security measures (patching, training) despite known risk.',
   array['security-breach','employee-data','fine'], 'UK'),

  ('ico_case', 'Ticketmaster UK Limited', 'ICO Monetary Penalty Notice, November 2020',
   'ICO fined Ticketmaster UK £1.25m after a third-party chat-bot script on its payment pages was compromised (a "Magecart"-style attack), harvesting payment card details of an estimated 9.4 million customers over several months.',
   'Relevant where the breach involved a third-party script/plugin on the controller''s own site — supports arguments that the controller remains responsible for vetting and monitoring third-party code processing customer payment data.',
   array['security-breach','third-party-script','payment-data','fine'], 'UK'),

  -- ---------------------------------------------------------------------
  -- Distress articulation / drafting guidance (original platform guidance,
  -- not case law — used to help translate a customer's own account into
  -- legally cognisable distress language, without inventing facts).
  -- ---------------------------------------------------------------------
  ('distress_wording', 'Loss of ability to verify financial affordability decisions', null,
   'Template reasoning for DSAR-related distress where an incomplete response prevented the data subject from checking whether a lender''s affordability/credit decision about them was properly conducted.',
   'Draft framing: "As a direct result of [Company]''s incomplete response to my subject access request, I was unable to verify what information was used to assess my [affordability/creditworthiness], leaving me unable to establish whether the decision made about me was fair or accurate. This uncertainty caused me ongoing anxiety about [specific consequence, e.g. a declined application / an adverse credit marker] and about whether inaccurate data about me is still being relied upon." Only use where the customer has actually described this uncertainty — do not assert consequences the customer has not evidenced.',
   array['dsar','affordability','template'], 'UK'),

  ('distress_wording', 'Fear of identity theft or financial fraud following a data breach', null,
   'Template reasoning for distress arising from exposure of identity or financial data in a breach.',
   'Draft framing: "Following notification that my [financial/identity] data had been compromised, I experienced genuine and ongoing concern about the risk of identity theft or fraud, which led me to [specific evidenced step, e.g. monitor my bank statements more frequently / place a fraud alert / change passwords]." The specific mitigating steps taken are the evidentiary anchor — generic fear without any described behavioural response reads as unsupported.',
   array['breach','identity-theft','template'], 'UK'),

  ('distress_wording', 'Disclosure of health or other special category data', null,
   'Template reasoning for distress from unauthorised disclosure of health, sexual orientation, religious, or other special category data.',
   'Draft framing: "The disclosure of my [specific special category data, e.g. medical condition] to [unintended recipient] without my knowledge or consent caused me significant distress and embarrassment, particularly because [specific reason, e.g. this information is not something I have shared with my employer / family]." Special category disclosures typically attract higher valuation given ICO precedent (see 56 Dean Street) — flag these claims for a wider valuation range.',
   array['special-category-data','template'], 'UK'),

  ('distress_wording', 'Repeated unwanted marketing after objection', null,
   'Template reasoning for distress from continued marketing communications after the data subject exercised their Art. 21(3) right to object.',
   'Draft framing: "Despite explicitly asking [Company] to stop contacting me for marketing purposes on [date], I continued to receive [number] further marketing [emails/calls/texts] on [dates], which caused frustration and made me feel my request had been ignored." Precise dates and a count of subsequent contacts materially strengthen this category — prompt the customer for exact dates/screenshots where possible.',
   array['marketing','objection','template'], 'UK'),

  ('distress_wording', 'Misdirected communication containing personal data', null,
   'Template reasoning for distress where personal data was sent to the wrong recipient.',
   'Draft framing: "On [date], [Company] sent my personal data, including [describe data], to [wrong recipient/description], without my knowledge. I was concerned about who had seen this information and whether it could be misused." Per Rolfe v Veale Wasbrough Vizards, a single low-sensitivity misdirected communication to a professional/confidential recipient may fall below the compensable threshold — the valuation module should weigh sensitivity of the data and identity of the recipient, not just the fact of misdirection.',
   array['misdirected-communication','template'], 'UK'),

  ('distress_wording', 'Aggravating factors that increase distress valuation', null,
   'Checklist of factors the valuation module should look for in the customer''s account and documents, as they correlate with higher awards/settlements in comparable ICO and court precedents.',
   'Aggravating factors: (1) special category data involved (health, sexual orientation, immigration status, criminal record); (2) large volume or long duration of exposure; (3) company''s response was dismissive, delayed beyond statutory deadlines, or contained further errors; (4) repeated incidents rather than a one-off; (5) identifiable real-world consequence (declined application, safety concern, relationship/employment impact); (6) vulnerable data subject. Mitigating factors: single low-sensitivity incident, prompt containment/correction by the company, professional/confidential recipient, no evidenced behavioural impact.',
   array['valuation','checklist'], 'UK'),

  ('distress_wording', 'De minimis caution for low-severity claims', null,
   'Guidance for the valuation and judge modules to avoid overstating trivial claims, consistent with Rolfe v Veale Wasbrough Vizards.',
   'Where a claim involves a single, low-sensitivity data point (e.g. a name and email address only), promptly corrected/contained, with no described distress beyond general annoyance, the judge model should flag the draft for a conservative valuation range and confirm the customer''s account before drafting formal correspondence, rather than assuming compensable harm by default.',
   array['de-minimis','valuation','judge-guidance'], 'UK'),

  ('distress_wording', 'DSAR non-response or incomplete response framing', null,
   'Template reasoning distinguishing (a) no response at all, (b) a late response, and (c) a response that omits required elements under Art. 15.',
   'Draft framing should specify exactly which failure occurred and cite the relevant date: "[Company] received my subject access request on [date]. Under Article 12(3) UK GDPR it was required to respond within one calendar month (i.e. by [date]). [It failed to respond at all / It responded on [date], [X] days late / It responded on [date] but omitted [specific missing element, e.g. the recipients my data was shared with, or the retention period]]." Precision on dates and the specific missing element(s) is what separates a strong claim from a generic complaint.',
   array['dsar','deadline','template'], 'UK')
) as v(category, title, citation, summary, full_text, tags, jurisdiction)
where not exists (
  select 1 from public.gdpr_kb existing where existing.title = v.title
);
