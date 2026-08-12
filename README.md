# Roofing CRM & Property Identification UI

## Context

Elephant is evaluating data-center development opportunities and needs a practical system for identifying, assembling, and acquiring suitable land. The immediate requirement is a basic CRM that combines county parcel data, map-based site analysis, owner contact information, and acquisition outreach tracking. Outreach channels (email, direct mail, SMS) should be fully mocked—no actual messages are sent.

## Description

Create a map-based parcel acquisition CRM that enables the team to identify adjacent properties within Rock Island County, IL, group them into potential data-center sites, evaluate nearby power infrastructure where data is available, and manage communication with property owners.

Integrate county parcel records with available ownership and contact data, then support outbound acquisition campaigns through mocked email, direct mail, and SMS. Track outreach, responses, follow-ups, and acquisition status for each parcel and proposed site.

## Acceptance Criteria
- Display Chester County, PA parcel data on an interactive map.
- Enable users to select individual parcels from the map.
- Group adjacent parcels into a proposed data-center project.
- Calculate the combined acreage of grouped parcels.
- Store parcel identifiers, ownership details, assessed values, and mailing addresses.
- Identify available data sources for nearby substations and power infrastructure.
- Display relevant power infrastructure on the parcel map where data is available.
- Attach mocked contact information to the appropriate property owner records.
- Create a CRM record for each owner, parcel, and proposed project.
- Support mocked email, direct-mail, and SMS acquisition campaigns.
- Track messages, responses, follow-ups, and contact history (all simulated).
- Record owner interest, asking price, and acquisition status.
- Assign acquisition tasks and next steps to team members.
- Filter projects by county, acreage, power access, outreach status, and acquisition stage.
- Export parcel, owner, and campaign data for further analysis.
- Show (disabled) sections on the CRM that would expand the CRM beyond the initial acquisition workflow.

## Demo Transcript
- From an RAG / map perspective, fill out a contiguous shape (e.g., approximate square) to identify project / parcel candidates.
- Highlight every parcel in the selected area.
- Create a “Project” based on the highlighted area and show the combined acreage.
- Check owner information completeness.
  - If complete → proceed.
  - If incomplete → show the “buy / enrich contact information” flow (mocked).
- In the workflow, initiate a mocked email campaign, direct-mail campaign, and SMS campaign.
- The UI simulation shows the full lifecycle: mail/email/SMS sent, received, short-link clicked, logged into the application, bounced, replied, etc.
- Demonstrate filtering projects by acreage, power proximity, outreach status, and acquisition stage.
- Show task assignment and next-step tracking for a selected owner/parcel/project.
- Export a sample dataset of parcels, owners, and campaign activity.

## Reference
- [Soofi XYZ Team Kit](https://github.com/soofi-xyz/soofi-xyz-team-kit)
- [Elephant Oracle Skills](https://github.com/elephant-xyz/skills)
