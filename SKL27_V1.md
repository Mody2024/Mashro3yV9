# SKL27 V1

SKL27 is a persistent 5v5 football-management game.

## V1 playable systems

- Account signup/login with hashed passwords and persistent sessions.
- Persistent club creation and squad.
- 5-player formations with goalkeeper validation.
- Tactics: formation, mentality, pressing, passing and defensive line.
- Friends League: create, invite, accept, start.
- 18-team league support with bot clubs filling remaining places.
- Double round-robin fixtures and persistent standings.
- Live server-authoritative match simulation with timeline, goals, shots, saves, possession and fatigue.
- Automatic bot-vs-bot match simulation.
- Matchday progression and season completion.
- Training with persistent attribute/fatigue changes.
- Transfer market and player purchases.
- Club finances and transaction history.
- Notifications for invitations, training, matches and league progression.

## Production deployment

The repository includes render.yaml. Render supports Node web services and persistent disks; the Blueprint mounts /var/data and sets SKL_DATA_DIR=/var/data so the JSON database survives service restarts/deploys.

Deploy from the Render Dashboard by creating a Blueprint from this repository:
https://render.com/

After deployment, Render gives the service its public onrender.com URL.

## Local test

Node.js 18+ is recommended.

    npm install
    npm run check
    npm start

Then open:

    http://localhost:3000

For production multiplayer, use a single running service instance with persistent storage. The current V1 uses a JSON database intentionally to keep the first release small and easy to operate. A later scale-up should migrate the same API to Postgres.
