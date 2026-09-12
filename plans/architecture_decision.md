# Architecture Decision: TavernaBot Modular Platform

## Status: Accepted
## Date: 2026-01-05
## Scope: Backend, Bot, Mini App, Automation

### Decision
The TavernaBot_V2 project is officially structured as a modular platform with 3 independent but connected milestones:

#### Milestone 1 — Core Marketplace (Data & Truth Layer)
Responsibility:
- Single source of truth for products and suppliers
- Parsing:
  - MyDrop XML
  - External sources (URL: Telegram / websites / marketplaces)
- Categorization of products
- Calculation of final retail prices for Taverna
  - Base markup
  - Aggressive rounding
- Storage of all data in database

Principles:
- Each product has Taverna's price
- Supplier ≠ retail
- Mini App never sees raw prices

#### Milestone 2 — Background Automation (24/7 Engine)
Responsibility:
- Telethon listener (supplier channels)
- Gemini AI:
  - Duplicate checking
  - Product matching (name + photo + description)
  - Category determination
- Publication queues
  - New supplier → priority in queue
- Auto posting / advertising
- Scheduler (APScheduler)
- Redis (queues, states)

Principles:
- Always operational
- No UI
- If no suppliers exist → idle without errors
- Does not block bot

#### Milestone 3 — UX / Admin / Mini App Experience
Responsibility:
- Mini App:
  - Supplier registration
  - Supplier profile (avatar, rating, reviews, turnover)
  - Product catalog
  - Order processing
- Admin UX:
  - Registration approval / rejection
  - Gemini reports
  - Manual management of products and suppliers
- Telegram UI:
  - Topics (categories)
  - "Order" buttons
  - Connection to Mini App

### Rationale
- Reduced complexity
- Ability to develop each block independently
- Stable 24/7 service operation
- Focus on supplier convenience and admin control
- Scalability without monolith

### Impact
- bot.py and web_app.py run in parallel, without calling each other
- Interaction only through DB / Redis / API
- Telethon listener is not considered an error if no channels exist
- Future UX development happens within Milestone 3 boundaries