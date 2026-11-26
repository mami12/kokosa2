# Arkitektura e Databazës së KOKOSA / FAQJA (Për Zhvilluesit)

Ky dokument përmbledh **skemën e plotë të databazës (`schema.sql`)**, inventarin e **53 tabelave**, dhe **shembuj të anonimizuar të rreshtave (`sample-rows-anonymized.json`)** në mënyrë të lexueshme për GitHub — pa llogari reale, fjalëkalime, bilance, tokenë API ose kredenciale Telegram.

---

## Përmbajtja e paketës
- [`schema.sql`](./schema.sql) — DDL i plotë PostgreSQL/PGlite i nxjerrë nga [`server/schema.mjs`](../../server/schema.mjs) dhe [`server/ledger/schema.mjs`](../../server/ledger/schema.mjs).
- [`sample-rows-anonymized.json`](./sample-rows-anonymized.json) — Struktura e plotë (kolonat, indekset, trigger-at, numri i rreshtave në snapshot) dhe shembuj JSON të anonimizuar të tabelave sportive e të shlyerjes.

---

## Si funksionon ndarja RAM vs Databazë lokale (PGlite)

1. **Lista live & prematch (`matches`, `odds_current`, `odds_history`, `raw_frames`)**:
   - Kur `MATCH_STORE=memory` dhe `ODDS_STORE=memory`, tregjet dhe ndeshjet aktive shërbehen nga memorja (`RAM`) që UI të mos bllokohet nga shpejtësia e diskut.
2. **Databaza financiare & e shlyerjes (`app_*`, ruajtur lokalisht në `data/database` përmes PGlite)**:
   - Ruhet çdo gjë që duhet të mbijetojë rinisjen: llogaritë, lëvizjet e portofolit, biletat, kontratat e ngrira në momentin e pranimit, rezultatet zyrtare dhe eventet e verifikuara nga Zizobet.

---

## Si regjistrohen bastet dhe si bëhet shlyerja

### 1. Vendosja e biletës
- **`app_ticket`** (`id`, `user_id`, `stake`, `total_odds`, `potential_payout`, `original_potential_payout`, `ticket_type`, `status`, `client_request_id`)
  - Trigger-i `app_ticket_quote` ruan `original_potential_payout` të pandryshueshme nga shlyerja përfundimtare (kërkesë e mbrojtur).
  - Indeksi unik `(user_id, client_request_id)` garanton idempotencë kundër klikimeve/kërkesave të dyfishta.
- **`app_transaction`** (`user_id`, `amount`, `type`, `reference_id`, `balance_after`)
  - Regjistron çdo lëvizje portofoli (`DEPOSIT`, `WITHDRAWAL`, `BET_PLACED`, `BET_WON`, `BET_REFUND`, `TICKET_REVERT`).
- **`app_ticket_line`** — çdo zgjedhje brenda biletës ruan:
  - Identitetin & koeficientin në momentin e pranimit (`match_id`, `market_key`, `line`, `outcome_key`, `outcome_name`, `market_name`, `match_name`, `odds_at_placement`).
  - **`accepted_contract` (JSONB)**: snapshot i pandryshueshëm i ofertës origjinale të ofruesit (`sourceProviderId`, `providerMarketId`, `providerMarketName`, `providerOutcomeId`, `providerOutcomeName`, `providerMarketKey`, `providerOutcomeKey`, `providerPeriod`, `nativeParameters`, `homeTeamName`, `awayTeamName`, `settlementHold`, `holdReason`).
  - **`live_contract` (JSONB)**: kontrata e strukturuar e ngrirë (p.sh. `{ kind: "half-next-event", half: 1, event: "goal", side: "home", target: 1, baseline: { home: 0, away: 0 } }`).
  - **`status`** (`PENDING` | `WON` | `LOST` | `VOID`), **`settled_odds`**, **`settlement_reason`** (p.sh. `NO_SETTLEMENT_RULE`, `NATIVE_PARAMETERS_UNMAPPED`, `NATIVE_FINAL_RULE_UNMAPPED`).

### 2. Rezultatet dhe kronologjia nga Zizobet (burimi autoritativ për shlyerjen)
- **`app_match_result`**: rezultati përfundimtar dhe statistikat agregate (`home_score`, `away_score`, `half_home_score`, `half_away_score`, `corners_home`, `corners_away`, `cards_home`, `cards_away`, `source`, `statistics` JSONB).
- **`app_match_half_result`**: rezultati i verifikuar i pjesës së parë (`half_home_score`, `half_away_score`, `signature`, `source`, `confirmed_at`).
- **`app_match_snapshot`**: snapshot-i i fundit i vëzhguar i ndeshjes për mbijetesë pas rinisjes (nuk shlyen vetë pa konfirmim FT).
- **`app_match_event_fact`**: çdo gol, korner ose karton me minutë reale, sekonda, ekip (`home` / `away`), `phase`, flag `active`, dhe emrat plotësues të lojtarëve (`aiscore_player_name` / `fotmob_player_name`).
- **`app_match_event_coverage`**: gjendja e mbulimit të eventeve për çdo ndeshje (`goal`, `corner`, `card`).
- **`app_zizobet_match_history`** & **`app_zizobet_match_incident`**: detajet dhe kronologjia historike `details` JSONB nga endpoint-i i historisë së Zizobet.

### 3. Arkivi i ofertave dhe fjalori i marketeve
- **`app_provider_market_definition`** (380 rreshta në snapshot): katalogu nativ i marketeve Zizobet (`native_market_id`, `native_market_name`, `definition` JSONB).
- **`app_provider_offer_current`** (~28k rreshta) & **`app_provider_offer_change`** (~773k rreshta): audit append-on-change i koeficienteve (arsyeja pse folderi binar `data/database` është ~1.15 GB).

### 4. API-të plotësuese (vetëm për shfaqje / emra lojtarësh, kurrë shlyerje autonome)
- **`app_football_information_map`** & **`app_football_information_snapshot`**: hartëzimi i verifikuar i ndeshjeve me AiScore / FotMob (`mapping_status`) dhe snapshot-et e ruajtura.
- **`app_supplemental_match_incident`** & **`app_supplemental_match_snapshot`**: incidentet plotësuese.
- **`app_stats_cache`** & **`app_stats_usage`**: cache 10-minutësh dhe kuotat ditore të API-ve.

### 5. Kontrolli administrativ, verifikimi manual dhe kazinoja
- **Admin & Politikat**: `app_board_settings`, `app_feed_override`, `app_market_catalog`, `app_market_category_policy`, `app_market_scope_policy`, `app_live_risk_settings`, `app_admin_audit`.
- **Shlyerje manuale & rishikim**: `app_stat_review`, `app_settlement_override`, `app_manual_review_notice`.
- **Përdoruesit & Komisionet**: `app_user`, `app_player_controls`, `app_bet_rejection`, `app_ticket_batch`, `app_bet_builder_template`, `app_manager_commission`, `app_commission_config`, `app_staff_transfer`, `app_financial_reset`.
- **Kazino**: `app_casino_settings`, `app_manager_casino_settings`, `app_casino_round` (me trigger-in `app_casino_commission_report`), `app_casino_gamble_state`, `app_casino_gamble_event`, `app_casino_freespin_state`, `app_casino_original_state`, `app_casino_original_event`.

---

## Si t'ia dërgosh zhvilluesit në `github.com/mami12/ddatab`
Ky folder (`docs/database-architecture/`) peshon vetëm rreth ~180 KB dhe nuk përmban asnjë të dhënë private të përdoruesve apo kredencial. Mund t'i ngarkosh direkt 3 skedarët (`README.md`, `schema.sql`, `sample-rows-anonymized.json`) në `github.com/mami12/ddatab` pasi t'i autentikosh me GitHub.
