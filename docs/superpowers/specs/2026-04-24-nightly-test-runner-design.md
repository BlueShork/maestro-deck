# Nightly Test Runner — Guide d'implémentation

> **Objectif** : construire un service cloud qui exécute les tests Maestro de tes clients chaque nuit, provisionne une VM Android éphémère par client via Terraform, et envoie un rapport email.
>
> Ce document t'enseigne Terraform et GCP au passage. Lis-le de bout en bout avant de coder.

---

## Table des matières

1. [Ce qu'on construit](#1-ce-quon-construit)
2. [Comment fonctionne Terraform](#2-comment-fonctionne-terraform)
3. [Prérequis](#3-prérequis)
4. [Étape 1 — Initialiser le projet GCP](#étape-1--initialiser-le-projet-gcp)
5. [Étape 2 — Structure Terraform](#étape-2--structure-terraform)
6. [Étape 3 — Buckets GCS et Firestore](#étape-3--buckets-gcs-et-firestore)
7. [Étape 4 — Module VM Android éphémère](#étape-4--module-vm-android-éphémère)
8. [Étape 5 — Docker Compose pour l'émulateur Android](#étape-5--docker-compose-pour-lémulateur-android)
9. [Étape 6 — Cloud Run Job (le runner)](#étape-6--cloud-run-job-le-runner)
10. [Étape 7 — Cloud Scheduler (le cron)](#étape-7--cloud-scheduler-le-cron)
11. [Étape 8 — Dashboard Next.js](#étape-8--dashboard-nextjs)
12. [Étape 9 — Authentification Google](#étape-9--authentification-google)
13. [Étape 10 — Rapport email](#étape-10--rapport-email)
14. [Étape 11 — IAM et permissions](#étape-11--iam-et-permissions)
15. [Ordre de déploiement](#ordre-de-déploiement)
16. [Tester le pipeline end-to-end](#tester-le-pipeline-end-to-end)

---

## 1. Ce qu'on construit

### Vue d'ensemble

```
Navigateur (utilisateur)
        │
        ▼
┌───────────────────────┐
│  Cloud Run            │  ← Dashboard Next.js (upload APK + YAML, voir résultats)
│  (dashboard + API)    │
└──────────┬────────────┘
           │
    ┌──────┴──────┐
    │             │
    ▼             ▼
  GCS          Firestore
(fichiers)    (jobs, résultats)

Cloud Scheduler ──► Cloud Run Job (runner)
  (2h00 chaque nuit)       │
                           │  Pour chaque job en parallèle :
                           ├─ terraform apply  ──► GCE VM (Docker Android + Maestro)
                           ├─ SCP fichiers vers la VM
                           ├─ SSH : lance les tests
                           ├─ Récupère les résultats
                           ├─ Upload artefacts → GCS
                           ├─ Email de rapport
                           └─ terraform destroy ──► VM supprimée
```

### Pourquoi une VM par job ?

Chaque client a ses propres fichiers, sa propre APK, ses propres tests. En donnant à chacun une VM isolée :
- Pas d'interférence entre les jobs
- La VM disparaît après → zéro coût pendant la journée
- La destruction est dans Terraform, donc fiable et reproductible

---

## 2. Comment fonctionne Terraform

> Si tu connais déjà Terraform, passe à l'étape 1.

### La philosophie

Terraform, c'est de l'**infrastructure as code** (IaC). Au lieu de cliquer dans la console GCP pour créer une VM, tu l'écris dans un fichier `.tf`. Terraform lit ce fichier et provisionne exactement ce que tu as décrit.

**Principe clé : l'état désiré.** Tu dis à Terraform "je veux une VM avec ces caractéristiques", et il se débrouille pour y arriver — qu'elle n'existe pas encore (création) ou qu'elle existe et doive changer (mise à jour).

### Les concepts essentiels

**Provider** — le plugin qui sait parler à un cloud. Pour GCP :
```hcl
terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = "mon-projet-gcp"
  region  = "europe-west1"
}
```

**Resource** — un objet infrastructure réel (VM, bucket, base de données...) :
```hcl
resource "google_compute_instance" "ma_vm" {
  name         = "test-runner-vm"
  machine_type = "n2-standard-4"
  zone         = "europe-west1-b"
  # ...
}
```

**Variable** — une valeur paramétrable :
```hcl
variable "job_id" {
  description = "Identifiant unique du job"
  type        = string
}

# Utilisation : var.job_id
```

**Output** — une valeur que Terraform expose après apply (ex: l'IP de la VM créée) :
```hcl
output "vm_ip" {
  value = google_compute_instance.ma_vm.network_interface[0].access_config[0].nat_ip
}
```

**State** — Terraform garde une trace de ce qu'il a créé dans un fichier `terraform.tfstate`. Pour qu'un job Cloud Run puisse créer ET détruire une VM, ce state doit être stocké dans GCS (pas en local).

```hcl
terraform {
  backend "gcs" {
    bucket = "mon-bucket-terraform-state"
    prefix = "jobs/job-abc123"  # 1 dossier par job = états isolés
  }
}
```

### Les 3 commandes que tu vas utiliser

```bash
terraform init     # Télécharge les providers, configure le backend
terraform apply    # Crée / met à jour l'infra (demande confirmation sauf si -auto-approve)
terraform destroy  # Supprime tout ce que Terraform a créé
```

### Module

Un module Terraform, c'est un dossier `.tf` réutilisable. Tu appelles un module comme une fonction :

```hcl
module "android_vm" {
  source = "./modules/android-vm"
  job_id = "abc123"
  zone   = "europe-west1-b"
}
```

On va écrire le module `android-vm` à l'étape 4.

---

## 3. Prérequis

Avant de commencer, installe et configure ces outils :

```bash
# 1. Terraform
brew install terraform
terraform --version  # doit afficher >= 1.7

# 2. Google Cloud CLI
brew install google-cloud-sdk
gcloud auth login
gcloud auth application-default login  # pour que Terraform s'authentifie

# 3. Docker (pour builder les images Cloud Run Job)
brew install --cask docker

# 4. Node.js 20+ et pnpm (pour le dashboard)
brew install node
npm install -g pnpm
```

Crée un projet GCP dédié dans la console : https://console.cloud.google.com/projectcreate

Note le **Project ID** (ex: `maestro-nightly-prod`) — tu en auras besoin partout.

---

## Étape 1 — Initialiser le projet GCP

### Active les APIs nécessaires

GCP désactive par défaut la plupart des services. Il faut les activer une fois :

```bash
export PROJECT_ID="maestro-nightly-prod"

gcloud services enable \
  compute.googleapis.com \
  run.googleapis.com \
  cloudscheduler.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  artifactregistry.googleapis.com \
  iam.googleapis.com \
  --project=$PROJECT_ID
```

> **Pourquoi ?** Chaque API correspond à un service GCP :
> - `compute` → VMs (GCE)
> - `run` → Cloud Run (dashboard + job)
> - `cloudscheduler` → le cron
> - `firestore` → base de données
> - `storage` → GCS (fichiers)
> - `artifactregistry` → registre Docker interne

### Structure du dépôt

Crée un dépôt séparé de Maestro Deck — c'est un produit différent :

```
maestro-nightly/
├── terraform/
│   ├── main.tf              # Infrastructure principale (permanente)
│   ├── variables.tf
│   ├── outputs.tf
│   └── modules/
│       └── android-vm/     # Module VM éphémère
│           ├── main.tf
│           ├── variables.tf
│           └── outputs.tf
├── runner/                  # Cloud Run Job
│   ├── Dockerfile
│   ├── runner.py            # Script principal
│   └── requirements.txt
├── dashboard/               # Next.js
│   ├── app/
│   ├── package.json
│   └── ...
└── android-docker/          # Config Docker Android pour la VM
    └── docker-compose.yml
```

---

## Étape 2 — Structure Terraform

### `terraform/variables.tf`

```hcl
variable "project_id" {
  description = "ID du projet GCP"
  type        = string
}

variable "region" {
  description = "Région GCP principale"
  type        = string
  default     = "europe-west1"
}

variable "zone" {
  description = "Zone GCP pour les VMs"
  type        = string
  default     = "europe-west1-b"
}
```

### `terraform/main.tf`

```hcl
terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  # Le state de l'infra principale est stocké dans GCS
  backend "gcs" {
    bucket = "maestro-nightly-terraform-state"
    prefix = "main"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
```

### Créer le bucket de state AVANT tout le reste

Le bucket qui stocke le state Terraform ne peut pas lui-même être géré par Terraform (problème de la poule et de l'œuf). Crée-le manuellement une seule fois :

```bash
gsutil mb -p $PROJECT_ID -l europe-west1 gs://maestro-nightly-terraform-state
gsutil versioning set on gs://maestro-nightly-terraform-state
```

> Le versioning permet de revenir à un état précédent si le state est corrompu.

---

## Étape 3 — Buckets GCS et Firestore

### `terraform/main.tf` (suite)

```hcl
# Bucket pour les fichiers clients (APK, YAML, artefacts)
resource "google_storage_bucket" "jobs" {
  name          = "${var.project_id}-jobs"
  location      = var.region
  force_destroy = false

  # Supprime automatiquement les artefacts après 30 jours
  lifecycle_rule {
    condition { age = 30 }
    action    { type = "Delete" }
  }
}

# Firestore en mode natif (base de données NoSQL de GCP)
resource "google_firestore_database" "main" {
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"
}
```

> **Firestore** est une base de données NoSQL de Google. Les données sont organisées en **collections** (comme des tables) et **documents** (comme des lignes JSON). Exemple :
>
> ```
> collection: jobs
>   document: job-abc123
>     {
>       userId: "user-xyz",
>       status: "pending",
>       apkPath: "gs://maestro-nightly-prod-jobs/user-xyz/job-abc123/app.apk",
>       yamlPaths: [...],
>       scheduledAt: "2026-04-25T02:00:00Z"
>     }
> ```

### Structure Firestore

Voici les collections dont tu as besoin :

```
/users/{userId}
  email: string
  createdAt: timestamp

/jobs/{jobId}
  userId: string
  status: "pending" | "running" | "success" | "failed"
  apkPath: string         ← chemin GCS
  yamlPaths: string[]     ← chemins GCS
  scheduledAt: timestamp
  startedAt: timestamp
  finishedAt: timestamp

/runs/{runId}
  jobId: string
  status: "success" | "failed"
  summary: { total: number, passed: number, failed: number }
  logPath: string         ← chemin GCS vers les logs bruts
  artifactsPath: string   ← chemin GCS vers les screenshots
  createdAt: timestamp
```

---

## Étape 4 — Module VM Android éphémère

C'est le cœur de l'architecture. Ce module Terraform crée une VM GCE avec tout ce qu'il faut pour faire tourner un émulateur Android.

### Pourquoi une VM et pas directement Cloud Run ?

Cloud Run fait tourner des containers Linux standard. Or, un émulateur Android nécessite **KVM** (kernel-based virtualization) — c'est de la virtualisation imbriquée. Cloud Run ne supporte pas KVM. Une GCE VM avec l'option `nested virtualization` activée le supporte.

### `terraform/modules/android-vm/variables.tf`

```hcl
variable "job_id" {
  description = "Identifiant unique du job (ex: job-abc123)"
  type        = string
}

variable "project_id" {
  type = string
}

variable "zone" {
  type    = string
  default = "europe-west1-b"
}

variable "machine_type" {
  description = "Type de machine GCE"
  type        = string
  default     = "n2-standard-4"  # 4 vCPU, 16 GB RAM — suffisant pour 1 émulateur
}

variable "service_account_email" {
  description = "Service account pour la VM"
  type        = string
}

variable "jobs_bucket_name" {
  type = string
}
```

### `terraform/modules/android-vm/main.tf`

```hcl
# Image de base avec nested virtualization activée
# Google fournit des images "cos" (Container-Optimized OS) ou Ubuntu adaptées
data "google_compute_image" "ubuntu" {
  family  = "ubuntu-2204-lts"
  project = "ubuntu-os-cloud"
}

resource "google_compute_instance" "android_runner" {
  name         = "android-runner-${var.job_id}"
  machine_type = var.machine_type
  zone         = var.zone

  # Active la virtualisation imbriquée (KVM) — obligatoire pour l'émulateur Android
  advanced_machine_features {
    enable_nested_virtualization = true
  }

  boot_disk {
    initialize_params {
      image = data.google_compute_image.ubuntu.self_link
      size  = 50  # GB — l'image Android + l'APK peuvent peser lourd
      type  = "pd-ssd"
    }
  }

  network_interface {
    network = "default"
    access_config {}  # Donne une IP publique (nécessaire pour SSH depuis Cloud Run Job)
  }

  service_account {
    email  = var.service_account_email
    scopes = ["cloud-platform"]
  }

  # Script exécuté au démarrage de la VM (une seule fois)
  # Il installe Docker et démarre le service
  metadata_startup_script = <<-EOT
    #!/bin/bash
    apt-get update -y
    apt-get install -y docker.io docker-compose-plugin
    systemctl enable docker
    systemctl start docker
    # Donne les droits Docker à l'utilisateur ubuntu
    usermod -aG docker ubuntu
    # Signal que le setup est terminé
    touch /tmp/setup-done
  EOT

  tags = ["android-runner"]

  labels = {
    job_id  = var.job_id
    managed = "terraform"
  }
}

# Règle de firewall pour autoriser SSH depuis le Cloud Run Job
resource "google_compute_firewall" "ssh_runner" {
  name    = "allow-ssh-runner-${var.job_id}"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = ["0.0.0.0/0"]  # À restreindre en prod avec l'IP du Cloud Run Job
  target_tags   = ["android-runner"]
}
```

### `terraform/modules/android-vm/outputs.tf`

```hcl
output "vm_ip" {
  description = "IP publique de la VM Android"
  value       = google_compute_instance.android_runner.network_interface[0].access_config[0].nat_ip
}

output "vm_name" {
  value = google_compute_instance.android_runner.name
}
```

---

## Étape 5 — Docker Compose pour l'émulateur Android

Ce fichier est copié sur la VM par le runner et démarre l'émulateur Android.

### `android-docker/docker-compose.yml`

```yaml
version: "3.8"

services:
  android-emulator:
    image: budtmo/docker-android:emulator_13.0
    # L'image budtmo/docker-android est la plus utilisée pour les émulateurs Android en CI
    # Elle inclut l'Android SDK, l'émulateur, et ADB
    privileged: true          # Nécessaire pour accéder à /dev/kvm
    devices:
      - /dev/kvm:/dev/kvm     # Monte le device KVM de la VM hôte dans le container
    environment:
      - EMULATOR_DEVICE=Samsung Galaxy S10
      - WEB_VNC=false         # Pas besoin de VNC pour le CI
      - APPIUM=false
    ports:
      - "5554:5554"           # Port ADB de l'émulateur
      - "5555:5555"           # Port ADB (alternative)
    volumes:
      - ./apk:/apk            # L'APK à tester sera montée ici
      - ./tests:/tests        # Les fichiers YAML Maestro
      - ./artifacts:/artifacts # Les screenshots et artefacts de sortie
    healthcheck:
      # Vérifie que l'émulateur est prêt (ADB répond)
      test: ["CMD", "adb", "-s", "emulator-5554", "shell", "echo", "ok"]
      interval: 10s
      timeout: 5s
      retries: 30             # Attend jusqu'à 5 minutes (l'émulateur est lent à démarrer)
      start_period: 60s
```

> **Pourquoi `privileged: true` et `/dev/kvm` ?**
>
> Un émulateur Android fait lui-même tourner un OS complet (Android). Pour que ça soit rapide, il utilise la virtualisation matérielle via KVM. Sans ça, l'émulateur doit tout émuler en logiciel — c'est 10x plus lent et souvent trop lent pour des tests.
>
> `/dev/kvm` est le device Linux qui expose KVM. On le "monte" dans le container Docker pour que l'émulateur y ait accès.

---

## Étape 6 — Cloud Run Job (le runner)

C'est le cerveau du pipeline. Il s'exécute en parallèle pour chaque job et orchestre tout.

### `runner/runner.py`

```python
#!/usr/bin/env python3
"""
Runner principal — exécuté comme une tâche Cloud Run Job.
Chaque instance gère 1 job utilisateur de bout en bout.
"""

import os
import subprocess
import json
import tempfile
from pathlib import Path
from datetime import datetime, timezone

from google.cloud import firestore, storage

# Variables d'environnement injectées par Cloud Run Job
JOB_ID = os.environ["JOB_ID"]
PROJECT_ID = os.environ["GOOGLE_CLOUD_PROJECT"]
JOBS_BUCKET = os.environ["JOBS_BUCKET"]
TERRAFORM_STATE_BUCKET = os.environ["TERRAFORM_STATE_BUCKET"]
ZONE = os.environ.get("GCP_ZONE", "europe-west1-b")

db = firestore.Client()
gcs = storage.Client()


def update_job_status(job_id: str, status: str, **kwargs):
    """Met à jour le statut du job dans Firestore."""
    data = {"status": status, **kwargs}
    db.collection("jobs").document(job_id).update(data)


def run_command(cmd: list[str], cwd: str = None, check: bool = True) -> subprocess.CompletedProcess:
    """Exécute une commande shell et affiche la sortie en temps réel."""
    print(f"$ {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=cwd, capture_output=False, check=check)
    return result


def provision_vm(job_id: str, project_id: str, zone: str, sa_email: str) -> str:
    """
    Crée la VM Android via Terraform.
    Retourne l'IP publique de la VM créée.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        # Copie le module Terraform dans un répertoire temporaire
        module_src = Path("/app/terraform/modules/android-vm")
        terraform_dir = Path(tmpdir) / "terraform"
        subprocess.run(["cp", "-r", str(module_src), str(terraform_dir)], check=True)

        # Fichier main.tf qui configure le backend GCS pour CE job
        main_tf = f"""
terraform {{
  required_providers {{
    google = {{ source = "hashicorp/google", version = "~> 5.0" }}
  }}
  backend "gcs" {{
    bucket = "{TERRAFORM_STATE_BUCKET}"
    prefix = "jobs/{job_id}"
  }}
}}

provider "google" {{
  project = "{project_id}"
  region  = "europe-west1"
}}

module "android_vm" {{
  source                = "./modules/android-vm"
  job_id                = "{job_id}"
  project_id            = "{project_id}"
  zone                  = "{zone}"
  service_account_email = "{sa_email}"
  jobs_bucket_name      = "{JOBS_BUCKET}"
}}

output "vm_ip" {{
  value = module.android_vm.vm_ip
}}
"""
        (terraform_dir / "main.tf").write_text(main_tf)

        run_command(["terraform", "init"], cwd=str(terraform_dir))
        run_command(["terraform", "apply", "-auto-approve"], cwd=str(terraform_dir))

        # Récupère l'IP de la VM depuis les outputs Terraform
        result = subprocess.run(
            ["terraform", "output", "-json"],
            cwd=str(terraform_dir),
            capture_output=True, text=True, check=True
        )
        outputs = json.loads(result.stdout)
        return outputs["vm_ip"]["value"]


def destroy_vm(job_id: str):
    """Supprime la VM Android via Terraform."""
    # Même approche : recréer la config Terraform et appeler destroy
    # (Terraform retrouve la VM grâce au state stocké dans GCS)
    print(f"Destroying VM for job {job_id}...")
    # ... (même logique que provision_vm mais avec terraform destroy)


def wait_for_ssh(ip: str, timeout: int = 180):
    """Attend que le SSH soit disponible sur la VM."""
    import time
    for i in range(timeout // 5):
        result = subprocess.run(
            ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5",
             f"ubuntu@{ip}", "echo ok"],
            capture_output=True
        )
        if result.returncode == 0:
            return
        time.sleep(5)
    raise TimeoutError(f"SSH not available on {ip} after {timeout}s")


def run_tests_on_vm(ip: str, job_data: dict) -> dict:
    """
    Transfère les fichiers sur la VM et exécute les tests.
    Retourne un résumé {total, passed, failed, logs}.
    """
    # Télécharge APK et YAML depuis GCS vers /tmp local
    with tempfile.TemporaryDirectory() as tmpdir:
        local_apk = f"{tmpdir}/app.apk"
        local_tests = f"{tmpdir}/tests"
        Path(local_tests).mkdir()

        # Télécharge l'APK depuis GCS
        bucket = gcs.bucket(JOBS_BUCKET)
        bucket.blob(job_data["apkPath"].replace(f"gs://{JOBS_BUCKET}/", "")).download_to_filename(local_apk)

        # Télécharge les fichiers YAML
        for i, yaml_path in enumerate(job_data["yamlPaths"]):
            bucket.blob(yaml_path.replace(f"gs://{JOBS_BUCKET}/", "")).download_to_filename(f"{local_tests}/{i:02d}.yaml")

        # Copie les fichiers sur la VM
        run_command(["scp", "-o", "StrictHostKeyChecking=no", local_apk, f"ubuntu@{ip}:/home/ubuntu/apk/app.apk"])
        run_command(["scp", "-o", "StrictHostKeyChecking=no", "-r", local_tests, f"ubuntu@{ip}:/home/ubuntu/tests/"])
        run_command(["scp", "-o", "StrictHostKeyChecking=no", "/app/android-docker/docker-compose.yml", f"ubuntu@{ip}:/home/ubuntu/"])

        # Démarre l'émulateur et attend qu'il soit prêt
        run_command(["ssh", "-o", "StrictHostKeyChecking=no", f"ubuntu@{ip}",
                     "cd /home/ubuntu && docker compose up -d && docker compose wait"])

        # Installe l'APK
        run_command(["ssh", "-o", "StrictHostKeyChecking=no", f"ubuntu@{ip}",
                     "adb install /home/ubuntu/apk/app.apk"])

        # Lance les tests Maestro
        result = subprocess.run(
            ["ssh", "-o", "StrictHostKeyChecking=no", f"ubuntu@{ip}",
             "maestro test /home/ubuntu/tests/ --format junit --output /home/ubuntu/artifacts/report.xml"],
            capture_output=True, text=True
        )

        # Récupère les artefacts
        run_command(["scp", "-o", "StrictHostKeyChecking=no", "-r",
                     f"ubuntu@{ip}:/home/ubuntu/artifacts/", f"{tmpdir}/artifacts/"])

        # Parse le rapport JUnit XML
        return parse_junit_report(f"{tmpdir}/artifacts/report.xml", result.stdout)


def parse_junit_report(xml_path: str, raw_logs: str) -> dict:
    """Parse le rapport JUnit de Maestro pour extraire pass/fail."""
    import xml.etree.ElementTree as ET
    try:
        tree = ET.parse(xml_path)
        root = tree.getroot()
        total = int(root.get("tests", 0))
        failures = int(root.get("failures", 0))
        errors = int(root.get("errors", 0))
        passed = total - failures - errors
        return {"total": total, "passed": passed, "failed": failures + errors, "logs": raw_logs}
    except Exception:
        return {"total": 0, "passed": 0, "failed": 1, "logs": raw_logs}


def send_email_report(job_data: dict, run_summary: dict, dashboard_url: str):
    """Envoie le rapport par email via Gmail API."""
    # Voir Étape 10 pour le détail de l'implémentation
    pass


def main():
    print(f"Starting runner for job {JOB_ID}")

    # 1. Charge le job depuis Firestore
    job_ref = db.collection("jobs").document(JOB_ID)
    job_data = job_ref.get().to_dict()

    if not job_data or job_data["status"] != "pending":
        print(f"Job {JOB_ID} is not pending, skipping")
        return

    update_job_status(JOB_ID, "running", startedAt=datetime.now(timezone.utc))

    try:
        # 2. Provisionne la VM Android
        sa_email = f"android-runner@{PROJECT_ID}.iam.gserviceaccount.com"
        vm_ip = provision_vm(JOB_ID, PROJECT_ID, ZONE, sa_email)
        print(f"VM ready at {vm_ip}")

        # 3. Attend que SSH soit disponible (la VM démarre en ~2 min)
        wait_for_ssh(vm_ip)

        # 4. Exécute les tests
        summary = run_tests_on_vm(vm_ip, job_data)

        # 5. Enregistre les résultats
        run_id = f"run-{JOB_ID}"
        db.collection("runs").document(run_id).set({
            "jobId": JOB_ID,
            "status": "success" if summary["failed"] == 0 else "failed",
            "summary": summary,
            "createdAt": datetime.now(timezone.utc),
        })

        update_job_status(JOB_ID, "success" if summary["failed"] == 0 else "failed",
                         finishedAt=datetime.now(timezone.utc))

        # 6. Envoie le rapport email
        user_data = db.collection("users").document(job_data["userId"]).get().to_dict()
        dashboard_url = f"https://maestro-nightly.com/runs/{run_id}"
        send_email_report(job_data, summary, dashboard_url)

    except Exception as e:
        print(f"Error: {e}")
        update_job_status(JOB_ID, "failed", error=str(e), finishedAt=datetime.now(timezone.utc))
        raise

    finally:
        # 7. Détruit TOUJOURS la VM — même en cas d'erreur
        try:
            destroy_vm(JOB_ID)
        except Exception as e:
            print(f"Warning: failed to destroy VM: {e}")
            # Log l'erreur mais ne lève pas — la VM sera détruite manuellement


if __name__ == "__main__":
    main()
```

### `runner/Dockerfile`

```dockerfile
FROM python:3.12-slim

# Installe Terraform
RUN apt-get update && apt-get install -y curl unzip openssh-client && \
    curl -fsSL https://releases.hashicorp.com/terraform/1.8.0/terraform_1.8.0_linux_amd64.zip -o terraform.zip && \
    unzip terraform.zip && mv terraform /usr/local/bin/ && rm terraform.zip

# Installe gcloud CLI (pour l'authentification)
RUN curl -fsSL https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz | tar xz && \
    ./google-cloud-sdk/install.sh --quiet && \
    ln -s /google-cloud-sdk/bin/gcloud /usr/local/bin/gcloud

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY runner.py .
COPY ../terraform/modules/ ./terraform/modules/
COPY ../android-docker/ ./android-docker/

CMD ["python", "runner.py"]
```

### `runner/requirements.txt`

```
google-cloud-firestore==2.16.0
google-cloud-storage==2.16.0
```

### Déployer le runner sur Artifact Registry

Avant de pouvoir utiliser l'image dans Cloud Run Job, il faut la pousser dans le registre Docker de GCP :

```bash
# Crée un registre Docker dans Artifact Registry
gcloud artifacts repositories create runners \
  --repository-format=docker \
  --location=europe-west1 \
  --project=$PROJECT_ID

# Build et push l'image
gcloud builds submit ./runner \
  --tag europe-west1-docker.pkg.dev/$PROJECT_ID/runners/test-runner:latest
```

---

## Étape 7 — Cloud Scheduler (le cron)

### Dans `terraform/main.tf`

```hcl
# Service account pour le Cloud Run Job
resource "google_service_account" "runner" {
  account_id   = "runner-sa"
  display_name = "Test Runner Service Account"
}

# Le Cloud Run Job qui exécute les tests
resource "google_cloud_run_v2_job" "test_runner" {
  name     = "nightly-test-runner"
  location = var.region

  template {
    task_count = 1  # Sera surchargé dynamiquement par le scheduler

    template {
      service_account = google_service_account.runner.email
      timeout         = "7200s"  # 2 heures max par job

      containers {
        image = "europe-west1-docker.pkg.dev/${var.project_id}/runners/test-runner:latest"

        env {
          name  = "GOOGLE_CLOUD_PROJECT"
          value = var.project_id
        }
        env {
          name  = "JOBS_BUCKET"
          value = google_storage_bucket.jobs.name
        }
        env {
          name  = "TERRAFORM_STATE_BUCKET"
          value = "maestro-nightly-terraform-state"
        }
        # JOB_ID sera injecté par le Cloud Scheduler
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }
    }
  }
}

# Cloud Scheduler qui déclenche le runner chaque nuit à 2h00
resource "google_cloud_scheduler_job" "nightly" {
  name      = "nightly-test-trigger"
  schedule  = "0 2 * * *"    # 2h00 chaque nuit (format cron standard)
  time_zone = "Europe/Paris"

  # Le scheduler appelle l'API Cloud Run Jobs pour déclencher le job
  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${google_cloud_run_v2_job.test_runner.name}:run"

    oauth_token {
      service_account_email = google_service_account.runner.email
    }
  }
}
```

> **Note sur le format cron** : `0 2 * * *` se lit de gauche à droite :
> - `0` → à la minute 0
> - `2` → à 2h
> - `*` → chaque jour du mois
> - `*` → chaque mois
> - `*` → chaque jour de la semaine
>
> Donc : "tous les jours à 2h00". Pour 2h30 le lundi seulement : `30 2 * * 1`

### Dispatcher : lancer 1 tâche par job en attente

Le Cloud Scheduler déclenche une seule exécution du Cloud Run Job. Mais on a besoin d'une tâche par utilisateur. La solution : un **dispatcher** — une première tâche légère qui lit Firestore, récupère tous les jobs `pending`, et crée une exécution Cloud Run Job par job.

```python
# dispatcher.py — appelé par Cloud Scheduler
def dispatch_nightly_jobs():
    db = firestore.Client()
    run_client = google.cloud.run_v2.JobsClient()

    # Récupère tous les jobs planifiés pour cette nuit
    pending_jobs = db.collection("jobs").where("status", "==", "pending").stream()

    for job_doc in pending_jobs:
        job_id = job_doc.id

        # Crée une exécution Cloud Run Job avec JOB_ID en variable d'env
        run_client.run_job(
            name=f"projects/{PROJECT_ID}/locations/{REGION}/jobs/nightly-test-runner",
            overrides={
                "container_overrides": [{
                    "env": [{"name": "JOB_ID", "value": job_id}]
                }]
            }
        )
        print(f"Dispatched job {job_id}")
```

---

## Étape 8 — Dashboard Next.js

### Initialisation

```bash
cd maestro-nightly/
pnpm create next-app dashboard --typescript --tailwind --app
cd dashboard
pnpm add firebase @google-cloud/firestore @google-cloud/storage
```

### Structure des pages

```
dashboard/app/
├── layout.tsx           # Layout global avec auth
├── page.tsx             # Redirect vers /dashboard ou /login
├── login/
│   └── page.tsx         # Page de connexion Google
├── dashboard/
│   ├── page.tsx         # Liste des jobs + runs récents
│   └── upload/
│       └── page.tsx     # Formulaire d'upload APK + YAML
└── runs/
    └── [runId]/
        └── page.tsx     # Détail d'un run (logs + artifacts)
```

### Page d'upload (`dashboard/app/dashboard/upload/page.tsx`)

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function UploadPage() {
  const [apk, setApk] = useState<File | null>(null);
  const [yamls, setYamls] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!apk || yamls.length === 0) return;

    setLoading(true);
    const form = new FormData();
    form.append("apk", apk);
    yamls.forEach((f) => form.append("yamls", f));

    const res = await fetch("/api/jobs", { method: "POST", body: form });
    const { jobId } = await res.json();
    router.push(`/dashboard?created=${jobId}`);
  }

  return (
    <main className="max-w-lg mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6">Nouveau job de test</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">APK Android</label>
          <input
            type="file"
            accept=".apk"
            onChange={(e) => setApk(e.target.files?.[0] ?? null)}
            className="w-full"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Fichiers YAML Maestro</label>
          <input
            type="file"
            accept=".yaml,.yml"
            multiple
            onChange={(e) => setYamls(Array.from(e.target.files ?? []))}
            className="w-full"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !apk || yamls.length === 0}
          className="w-full bg-blue-600 text-white py-2 rounded disabled:opacity-50"
        >
          {loading ? "Upload en cours..." : "Créer le job"}
        </button>
      </form>
    </main>
  );
}
```

### API Route pour créer un job (`dashboard/app/api/jobs/route.ts`)

```ts
import { NextRequest, NextResponse } from "next/server";
import { Firestore } from "@google-cloud/firestore";
import { Storage } from "@google-cloud/storage";
import { getAuthenticatedUser } from "@/lib/auth";

const db = new Firestore();
const storage = new Storage();
const BUCKET = process.env.JOBS_BUCKET!;

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const apk = form.get("apk") as File;
  const yamls = form.getAll("yamls") as File[];

  const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const basePath = `${user.uid}/${jobId}`;

  // Upload APK vers GCS
  const apkBuffer = Buffer.from(await apk.arrayBuffer());
  const apkPath = `${basePath}/app.apk`;
  await storage.bucket(BUCKET).file(apkPath).save(apkBuffer);

  // Upload YAML files vers GCS
  const yamlPaths: string[] = [];
  for (const yaml of yamls) {
    const buffer = Buffer.from(await yaml.arrayBuffer());
    const path = `${basePath}/tests/${yaml.name}`;
    await storage.bucket(BUCKET).file(path).save(buffer);
    yamlPaths.push(path);
  }

  // Crée le document job dans Firestore
  await db.collection("jobs").doc(jobId).set({
    userId: user.uid,
    status: "pending",
    apkPath: `gs://${BUCKET}/${apkPath}`,
    yamlPaths: yamlPaths.map((p) => `gs://${BUCKET}/${p}`),
    scheduledAt: new Date(),
    createdAt: new Date(),
  });

  return NextResponse.json({ jobId });
}
```

---

## Étape 9 — Authentification Google

### Configurer Identity Platform (Firebase Auth côté GCP)

```bash
# Active Identity Platform dans GCP
gcloud services enable identitytoolkit.googleapis.com --project=$PROJECT_ID
```

Dans la console GCP → Identity Platform → Ajouter un fournisseur → Google.

### `dashboard/lib/auth.ts`

```ts
import { initializeApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
};

if (!getApps().length) initializeApp(firebaseConfig);

export const auth = getAuth();

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  return result.user;
}
```

---

## Étape 10 — Rapport email

GCP n'a pas de service email natif. La solution la plus simple dans l'écosystème Google : l'**API Gmail** (si tu as un compte Google Workspace) ou **SendGrid** (free tier généreux, 100 emails/jour).

### Option Gmail API (`runner/email.py`)

```python
import base64
from email.mime.text import MIMEText
from googleapiclient.discovery import build
from google.oauth2 import service_account

def send_report_email(to: str, job_name: str, summary: dict, dashboard_url: str):
    """Envoie un rapport HTML via l'API Gmail."""

    passed = summary["passed"]
    total = summary["total"]
    status_emoji = "✅" if summary["failed"] == 0 else "❌"

    html_body = f"""
    <html><body>
    <h2>{status_emoji} Rapport Maestro — {job_name}</h2>
    <p><strong>{passed}/{total} tests passés</strong></p>
    <table border="1" cellpadding="8">
      <tr><th>Résultat</th><th>Nombre</th></tr>
      <tr><td>✅ Passés</td><td>{summary['passed']}</td></tr>
      <tr><td>❌ Échoués</td><td>{summary['failed']}</td></tr>
      <tr><td>Total</td><td>{total}</td></tr>
    </table>
    <br>
    <a href="{dashboard_url}">Voir le détail sur le dashboard →</a>
    </body></html>
    """

    message = MIMEText(html_body, "html")
    message["to"] = to
    message["subject"] = f"{status_emoji} Tests Maestro : {passed}/{total} passés"

    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()

    # Authentification via le service account du runner
    creds = service_account.Credentials.from_service_account_file(
        "/app/credentials.json",
        scopes=["https://www.googleapis.com/auth/gmail.send"],
        subject="noreply@ton-domaine.com"  # Adresse Gmail de l'expéditeur
    )
    service = build("gmail", "v1", credentials=creds)
    service.users().messages().send(userId="me", body={"raw": raw}).execute()
```

---

## Étape 11 — IAM et permissions

IAM (Identity and Access Management) contrôle **qui peut faire quoi** dans GCP. Le principe est **moindre privilège** : chaque composant a uniquement les permissions dont il a besoin.

```hcl
# Dans terraform/main.tf

# Le runner a besoin de : créer/détruire des VMs, lire/écrire GCS, lire/écrire Firestore
resource "google_project_iam_member" "runner_compute_admin" {
  project = var.project_id
  role    = "roles/compute.admin"
  member  = "serviceAccount:${google_service_account.runner.email}"
}

resource "google_project_iam_member" "runner_storage_admin" {
  project = var.project_id
  role    = "roles/storage.admin"
  member  = "serviceAccount:${google_service_account.runner.email}"
}

resource "google_project_iam_member" "runner_firestore_editor" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.runner.email}"
}

# Le dashboard (Cloud Run) peut lire/écrire GCS et Firestore, mais PAS créer de VMs
resource "google_service_account" "dashboard" {
  account_id   = "dashboard-sa"
  display_name = "Dashboard Service Account"
}

resource "google_project_iam_member" "dashboard_storage" {
  project = var.project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:${google_service_account.dashboard.email}"
}

resource "google_project_iam_member" "dashboard_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.dashboard.email}"
}

# Le Cloud Run (dashboard) en lui-même
resource "google_cloud_run_v2_service" "dashboard" {
  name     = "maestro-dashboard"
  location = var.region

  template {
    service_account = google_service_account.dashboard.email
    containers {
      image = "europe-west1-docker.pkg.dev/${var.project_id}/runners/dashboard:latest"
      env {
        name  = "JOBS_BUCKET"
        value = google_storage_bucket.jobs.name
      }
    }
  }
}

# Rend le dashboard accessible publiquement (sans auth GCP — l'auth est dans l'app)
resource "google_cloud_run_service_iam_member" "public" {
  location = google_cloud_run_v2_service.dashboard.location
  service  = google_cloud_run_v2_service.dashboard.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
```

---

## Ordre de déploiement

Suis cet ordre le jour J pour éviter les dépendances cassées :

```bash
# 1. Créer le bucket de state Terraform manuellement (une seule fois)
gsutil mb -p $PROJECT_ID -l europe-west1 gs://maestro-nightly-terraform-state
gsutil versioning set on gs://maestro-nightly-terraform-state

# 2. Déployer l'infrastructure principale (buckets, Firestore, IAM, Cloud Run Job, Scheduler)
cd terraform/
terraform init
terraform apply

# 3. Builder et pousser l'image du runner
gcloud builds submit ../runner \
  --tag europe-west1-docker.pkg.dev/$PROJECT_ID/runners/test-runner:latest

# 4. Builder et pousser l'image du dashboard
gcloud builds submit ../dashboard \
  --tag europe-west1-docker.pkg.dev/$PROJECT_ID/runners/dashboard:latest

# 5. Redéployer Cloud Run avec les nouvelles images
terraform apply  # Re-apply pour que Cloud Run prenne les nouvelles images
```

---

## Tester le pipeline end-to-end

Ne pas attendre 2h00 pour tester. Déclenche le runner manuellement :

```bash
# Crée un job de test dans Firestore
gcloud firestore documents create \
  "projects/$PROJECT_ID/databases/(default)/documents/jobs/test-job-001" \
  --fields='userId=string:test-user,status=string:pending,apkPath=string:gs://...,...'

# Déclenche le Cloud Run Job manuellement avec ce job_id
gcloud run jobs execute nightly-test-runner \
  --region=europe-west1 \
  --update-env-vars JOB_ID=test-job-001 \
  --project=$PROJECT_ID

# Surveille les logs en temps réel
gcloud run jobs executions logs tail \
  --region=europe-west1 \
  --project=$PROJECT_ID
```

### Checklist de validation

- [ ] La VM est créée dans GCP Console → Compute Engine pendant le run
- [ ] L'émulateur Android démarre dans Docker (vérifie les logs)
- [ ] Les tests Maestro s'exécutent et produisent un rapport XML
- [ ] Les artefacts sont uploadés dans GCS
- [ ] Firestore est mis à jour avec le résultat
- [ ] L'email de rapport est reçu
- [ ] La VM est détruite après le run (plus visible dans GCP Console)

---

## Points de vigilance

| Risque | Mitigation |
|--------|-----------|
| Quota GCE (trop de VMs en parallèle) | Vérifie le quota `CPUS_ALL_REGIONS` dans GCP Console avant le premier run en prod |
| VM pas détruite en cas d'erreur | Le `finally` dans `runner.py` garantit `destroy_vm()` même en cas d'exception |
| Coût inattendu | Active les alertes de budget GCP (Billing → Budgets & Alerts) |
| Emulateur lent à démarrer | Le healthcheck Docker attend jusqu'à 5 min — suffisant dans 95% des cas |
| State Terraform corrompu | Le versioning GCS permet de restaurer le state précédent manuellement |

---

*Document généré le 2026-04-24. Architecture PoC — non production-ready sur les aspects billing, multi-tenant et sécurité réseau.*
