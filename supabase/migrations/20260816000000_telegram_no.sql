-- supabase/migrations/20260816000000_telegram_no.sql
-- Telegram bot project numbers used by the "Copy bot command" panel.
-- Same change as db/migrations/0003_telegram_no.sql (native backend).
--
-- Idempotent: safe to re-run after an earlier partial/manual application.
--
-- Existing RLS policies already cover the new column: projects are selectable
-- by all authenticated users and updatable by admin/pm (projects_update_manager),
-- activity_types are selectable by all and updatable by admin
-- (activity_types_update_admin).

alter table public.projects
  add column if not exists telegram_no int;

alter table public.activity_types
  add column if not exists telegram_no int;

create unique index if not exists projects_telegram_no_key
  on public.projects (telegram_no) where telegram_no is not null;
create unique index if not exists activity_types_telegram_no_key
  on public.activity_types (telegram_no) where telegram_no is not null;

-- Seed project numbers (ID -- Name pairs taken from the bot's /projects list).
update public.projects set telegram_no = v.no
from (values
  ('025-DEC-2183 - RedHat Ansible Solution to Commercial Bank', 147),
  ('2023-MAY-0109-EC-UPGRADE-DIALOG', 104),
  ('2024-AUG-0736-ODA-OVM2KVM-PEOPLES-BANK', 110),
  ('2024-JUN-0384-HCP-SLT', 98),
  ('2024-NOV-1139-ORACLE-DB-FIRST-CAPITAL', 108),
  ('2024-SEP-0804-DARKTRACE-BOC', 99),
  ('2024-SEP-0846-DC-VIRTUALIZATION-LAUGFS', 100),
  ('2025-AUG-1051-COMMVAULT-INFRA-REVAMP-LB_FINANCE', 138),
  ('2025-AUG-1098 - Firewalla and Switch Replacement - LFSBL', 145),
  ('2025-Dec-2120-ALLIANZ-INSURENCE-CITRIX-IMPLEMENTATION', 137),
  ('2025-Dec-2183', 191),
  ('2025-DEC-2201-DR-DMZ-Cluster-Alignment-Project-CEB', 151),
  ('2025-DEC-2243-CARGILLS-BANK-UPGRADE', 170),
  ('2025-JAN-1631-CEB-DC-IMPLEMENTATION', 136),
  ('2025-JUL-0722-HYPERV2AZURE-A&E', 111),
  ('2025-JUN-0462-BACKUP-IMPLEMENTATION-SILVERMILLS', 102),
  ('2025-MAR-2002-MANAGE-ENGINE-DIMO', 105),
  ('2025-MAY-0291-BMC-HELIX-SAMPATH-BANK', 101),
  ('2025-May-0298 BoC Finacal', 166),
  ('2025-MAY-0383-OCEAN-DORADO-UNDP-CIABOC', 106),
  ('2025-MAY-0551-OCEAN-PROTECT-UNDP-CIABOC', 107),
  ('2025-NOV-2006-NARA-IMPLEMENTATION', 127),
  ('2025-NOV-2029 AD & File server deployment Opex Agrin', 169),
  ('2025-OCT-1581-ORACLE-AUDIT-FIRST-CAPITAL', 109),
  ('2025-OCT-1687-DC-VIRTUALIZATION-SIMPLIVITY-DLB', 125),
  ('2025-OCT-1801-SLIIT RedHat OpenShift-SLIIT', 143),
  ('2025-OCT-1835-METACNO-HARDWARE-IMPLEMENTATION', 128),
  ('2025-SEP-1295-VEEM-BACKUP-CEB', 103),
  ('2025-SEP-1377-MANAGE-ENGINE-SLIC', 126),
  ('Abans Backup Solution', 225),
  ('Amana Bank PCA Deployment', 223),
  ('Certifications', 112),
  ('Commercial Bank Citrix Deployment 2026-Mar-2870', 190),
  ('DIMO Mange engine', 230),
  ('Isabella_win_server_Sql licence implementation', 222),
  ('LB Finace Synergy 480 Gen12', 228),
  ('Meetings', 141),
  ('NTB Huawei OceanProtect & Commvault Capacity Upgrade | 2026-MAR-3076', 226),
  ('POC', 129),
  ('Pulse', 144),
  ('R&D', 142),
  ('SLSI LIMS Project', 231),
  ('Support', 94),
  ('TATA Lanka Server Project', 224)
) as v(name, no)
where public.projects.name = v.name
  and public.projects.telegram_no is null;

-- Seed activity-type fallbacks.
update public.activity_types set telegram_no = v.no
from (values
  ('R&D', 142),
  ('Meeting', 141),
  ('Certification', 112),
  ('Presales support', 94)
) as v(name, no)
where public.activity_types.name = v.name
  and public.activity_types.telegram_no is null;