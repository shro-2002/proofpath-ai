"""Builds demo_data/sample.json. Fictional person and companies; clearly labelled sample data."""

import json
from pathlib import Path

RESUME = """Jordan Avery (fictional sample candidate)
Senior Operations Analyst, Northwind Logistics (2021-present)
- Built weekly SQL reports on PostgreSQL covering 40M shipment records for regional operations leads.
- Designed and maintained Tableau dashboards used by 120 managers to track on-time delivery.
- Analysed a pricing experiment for express delivery and presented the A/B test results to the VP of Operations.
- Wrote Python scripts with pandas to clean carrier invoices, cutting manual reconciliation from 2 days to 3 hours.
- Partnered with finance and warehouse stakeholders to define KPIs and communicate trade-offs in plain language.

Operations Analyst, Brightline Retail (2018-2021)
- Maintained Excel forecasting models for store staffing across 35 locations.
- Automated a monthly inventory variance report using SQL and scheduled exports.

Education
B.Com, University of Pune, 2018. Completed online courses in statistics and introductory machine learning.

Skills: SQL, Tableau, Excel, Python (pandas), stakeholder communication."""

JDS = [
    {
        "title": "Data Scientist, Pricing",
        "company": "Fabrikam Travel (fictional)",
        "role_family": "Data Scientist",
        "text": """We are hiring a Data Scientist to improve dynamic pricing across our booking flows.

What you will do:
- Design and analyse A/B tests that measure the revenue impact of pricing changes.
- Build and validate machine learning models for demand forecasting.
- Translate analysis into clear recommendations for product and commercial stakeholders.

Requirements:
- Strong SQL skills and experience working with large datasets.
- Proficiency in Python, including pandas and scikit-learn.
- Solid grounding in statistics, including hypothesis testing and confidence intervals.
- Experience communicating results to non-technical stakeholders.

Nice to have:
- Experience with causal inference methods.
- Familiarity with Git and code review workflows.""",
    },
    {
        "title": "Data Scientist, Customer Growth",
        "company": "Contoso Health (fictional)",
        "role_family": "Data Scientist",
        "text": """Contoso Health is looking for a Data Scientist to join the growth team.

Responsibilities:
- Own experimentation for onboarding, from A/B test design through to readouts.
- Build churn prediction models using machine learning and evaluate them on held-out data.
- Perform feature engineering on product usage and claims data.

You should have:
- 2+ years of experience using Python for data analysis and modelling.
- Advanced SQL and comfort with messy, real-world data.
- Applied statistics knowledge such as regression, power analysis and sampling.
- Ability to explain model behaviour and limitations to stakeholders.

Preferred:
- Experience with Tableau or Looker for self-serve reporting.
- Exposure to cloud platforms such as AWS or GCP.""",
    },
    {
        "title": "Machine Learning Engineer",
        "company": "Tailspin Mobility (fictional)",
        "role_family": "ML Engineer",
        "text": """Tailspin Mobility is building real-time ETA prediction for 2 million daily trips.

In this role you will:
- Train, evaluate and ship machine learning models to production.
- Own model deployment and serving behind low-latency APIs.
- Set up monitoring for data drift and model performance (MLOps).

Must have:
- Strong Python engineering skills and experience with Git.
- Hands-on machine learning experience with scikit-learn or PyTorch.
- Experience packaging services with Docker.
- Experience deploying workloads on a cloud platform such as AWS or GCP.

Bonus:
- Experience with Spark for large-scale feature pipelines.
- Experience with Airflow or similar orchestration tools.""",
    },
    {
        "title": "Analytics Engineer",
        "company": "Litware Payments (fictional)",
        "role_family": "Analytics Engineer",
        "text": """Litware Payments needs an Analytics Engineer to own the transformation layer of our warehouse.

You will:
- Build and test dbt models that turn raw payment events into trusted tables.
- Design dimensional data models for finance and risk reporting.
- Partner with analysts and stakeholders to define metrics and documentation.

Requirements:
- Expert SQL, including window functions and query performance tuning.
- Experience with dbt in production.
- Strong data modeling fundamentals (star schemas, slowly changing dimensions).
- Working knowledge of Git and pull-request based workflows.

Nice to have:
- Python for data tooling.
- Experience with Airflow for scheduling.""",
    },
]

SAMPLE = {
    "label": "Sample data: fictional candidate and fictional companies, written for this demo.",
    "resume_text": RESUME,
    "target_role": "Data Scientist",
    "current_role": "Operations Analyst",
    "hours_per_week": 8,
    "jds": JDS,
}

if __name__ == "__main__":
    out = Path(__file__).with_name("sample.json")
    out.write_text(json.dumps(SAMPLE, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {out}")
