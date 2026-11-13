from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import plotly.graph_objects as go
import streamlit as st

from analytics_data import (
    DAILY_METRICS,
    DashboardDataset,
    export_csv,
    export_json,
    filtered_points,
    import_dataset,
    summarize_period,
)


st.set_page_config(
    page_title="Travel Friend · Analytics",
    page_icon="✦",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown(
    """
    <style>
      .block-container {max-width: 1440px; padding-top: 2rem; padding-bottom: 3rem;}
      [data-testid="stSidebar"] {background: #f5f7fb; border-right: 1px solid #e7ebf2;}
      .hero {padding: 1.35rem 1.6rem; border-radius: 18px; background: linear-gradient(115deg,#14253d,#21466a); color: white; margin-bottom: 1.15rem;}
      .hero h1 {font-size: 2rem; margin: 0 0 .35rem 0; letter-spacing: -.035em;}
      .hero p {margin: 0; color: #d4e0ed; font-size: 1rem;}
      .source-pill {display: inline-block; padding: .3rem .65rem; border-radius: 999px; background: #eaf2ff; color: #204b7c; font-size: .78rem; font-weight: 700; letter-spacing: .04em;}
      .demo-pill {background: #fff0c2; color: #684500;}
      .footnote {color: #697789; font-size: .88rem;}
      div[data-testid="stMetric"] {border: 1px solid #e7ebf2; border-radius: 14px; background: white; padding: .9rem 1rem; box-shadow: 0 2px 10px rgba(23,44,68,.035);}
      div[data-testid="stMetricLabel"] p {font-size: .82rem; color: #617287;}
      .section-card {border: 1px solid #e7ebf2; border-radius: 14px; padding: 1rem 1.15rem; background: #fff;}
    </style>
    """,
    unsafe_allow_html=True,
)


def _dataset_dates(dataset: DashboardDataset) -> tuple[date, date] | None:
    day_dates = [point.period_start for point in dataset.points if point.period_type == "day"]
    if day_dates:
        return min(day_dates), max(day_dates)
    week_dates = [point.period_start for point in dataset.points if point.period_type == "week"]
    if week_dates:
        return min(week_dates), max(week_dates) + timedelta(days=6)
    snapshot_dates = [point.period_start for point in dataset.points if point.period_type == "snapshot"]
    if snapshot_dates:
        return min(snapshot_dates), max(snapshot_dates)
    return None


def _daily_values(dataset: DashboardDataset, metric: str, start: date, end: date) -> tuple[list[date], list[int]]:
    selected = {
        point.period_start: point.value
        for point in dataset.points
        if point.period_type == "day" and point.metric == metric and start <= point.period_start <= end
    }
    days = sorted(selected)
    return days, [selected[day] for day in days]


def _chart(title: str, series: list[tuple[str, str, list[date], list[int]]], *, kind: str = "line") -> None:
    figure = go.Figure()
    for name, color, dates, values in series:
        if kind == "bar":
            figure.add_trace(go.Bar(name=name, x=dates, y=values, marker_color=color))
        else:
            figure.add_trace(
                go.Scatter(
                    name=name,
                    x=dates,
                    y=values,
                    mode="lines+markers",
                    line={"color": color, "width": 2.5},
                    marker={"size": 5},
                    hovertemplate="%{x|%d %b %Y}<br>%{y:,}<extra>%{fullData.name}</extra>",
                )
            )
    figure.update_layout(
        title={"text": title, "x": 0.02, "xanchor": "left", "font": {"size": 16}},
        height=330,
        margin={"l": 12, "r": 12, "t": 54, "b": 14},
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        hovermode="x unified",
        legend={"orientation": "h", "y": 1.12, "x": 0},
        xaxis={"showgrid": False, "title": None},
        yaxis={"rangemode": "tozero", "gridcolor": "#edf1f6", "title": None},
        barmode="group",
    )
    st.plotly_chart(figure, width="stretch", config={"displayModeBar": False})


def _value(summary, metric: str) -> int | None:
    if metric in DAILY_METRICS:
        return summary.daily[metric] if summary.daily_available else None
    if metric == "wcat":
        return summary.wcat if summary.wcat_available else None
    if metric == "registered_accounts_ever":
        return summary.registered_accounts_ever
    return None


def _metric(label: str, value: int | None, help_text: str | None = None) -> None:
    st.metric(label, f"{value:,}" if value is not None else "Нет данных", help=help_text)


st.sidebar.markdown("## Travel Friend")
st.sidebar.caption("Командная аналитика · локальный режим")
mode = st.sidebar.radio("Источник данных", ("DEMO", "Импорт агрегатов"), index=0)

dataset: DashboardDataset
if mode == "DEMO":
    demo_path = Path(__file__).resolve().parent / "data" / "demo.json"
    imported_demo = import_dataset(demo_path.read_bytes(), demo_path.name)
    dataset = DashboardDataset(
        "DEMO — СИНТЕТИЧЕСКИЕ ДАННЫЕ",
        imported_demo.points,
        imported_demo.generated_at_utc,
    )
else:
    uploaded_file = st.sidebar.file_uploader(
        "Загрузить CSV или JSON с агрегатами",
        type=["csv", "json"],
        accept_multiple_files=False,
        max_upload_size=1,
        help="Файл проверяется по строгой схеме и остаётся в памяти сессии.",
    )
    if uploaded_file is None:
        st.info("Загрузите aggregate CSV/JSON. Пользовательские строки и произвольные поля не принимаются.")
        st.stop()
    try:
        dataset = import_dataset(uploaded_file.getvalue(), uploaded_file.name)
    except ValueError as error:
        st.error(f"Файл не принят: {error}")
        st.stop()

date_bounds = _dataset_dates(dataset)
if date_bounds is None:
    st.markdown('<div class="hero"><h1>Аналитика Travel Friend</h1><p>Нет агрегированных данных для отображения.</p></div>', unsafe_allow_html=True)
    st.info("Загрузите CSV/JSON с периодами или выберите DEMO.")
    st.stop()

min_date, max_date = date_bounds
st.sidebar.markdown("### Период · UTC")
selected_range = st.sidebar.date_input(
    "Дата начала и конца",
    value=(min_date, max_date),
    min_value=min_date,
    max_value=max_date,
    format="YYYY-MM-DD",
)
if isinstance(selected_range, tuple) and len(selected_range) == 2:
    start_date, end_date = selected_range
else:
    start_date = end_date = selected_range
if end_date < start_date:
    st.sidebar.error("Конец периода не может быть раньше начала.")
    st.stop()

summary = summarize_period(dataset, start_date, end_date)
report_points = filtered_points(dataset, start_date, end_date)
source_class = "source-pill demo-pill" if dataset.source_label.startswith("DEMO") else "source-pill"
source_display = "DEMO · синтетические данные" if dataset.source_label.startswith("DEMO") else "ИМПОРТИРОВАННЫЕ АГРЕГАТЫ"

st.markdown(
    f'<div class="hero"><h1>Travel Friend · Analytics</h1><p>Командная панель по агрегатам · UTC</p></div>',
    unsafe_allow_html=True,
)
st.markdown(f'<span class="{source_class}">{source_display}</span>', unsafe_allow_html=True)
if dataset.source_label.startswith("DEMO"):
    st.warning("DEMO · все числа на панели синтетические и не являются production-метриками.", icon="⚠️")
else:
    st.caption("Источник: импортированный локальный файл. Его происхождение отдельно не подтверждается.")

if not summary.daily_available and not summary.wcat_available:
    st.info("В выбранном периоде нет временных агрегатов. Итоговый snapshot пользователей может быть показан отдельно.")

st.sidebar.markdown("### Экспорт отчёта")
csv_export = export_csv(report_points)
json_export = export_json(report_points, source_label="DEMO" if dataset.source_label.startswith("DEMO") else "IMPORTED AGGREGATES")
period_name = f"{start_date.isoformat()}_{end_date.isoformat()}"
st.sidebar.download_button("Скачать CSV", csv_export, file_name=f"travel-friend-report-{period_name}.csv", mime="text/csv", width="stretch")
st.sidebar.download_button("Скачать JSON", json_export, file_name=f"travel-friend-report-{period_name}.json", mime="application/json", width="stretch")
st.sidebar.caption("Экспорт содержит только агрегаты и временные периоды.")

overview, users_tab, discover_tab, trips_tab = st.tabs(
    ["Overview", "Users", "Discover & Chats", "Trips & Proposals"]
)

with overview:
    st.subheader("Ключевые показатели")
    kpis = st.columns(4)
    with kpis[0]:
        _metric("Зарегистрировано всего", _value(summary, "registered_accounts_ever"), "Snapshot на дату последнего доступного отчёта")
    with kpis[1]:
        _metric("Новые пользователи", _value(summary, "new_users"), "Созданные аккаунты за выбранный период")
    with kpis[2]:
        _metric("Мэтчи", _value(summary, "matches_created"))
    with kpis[3]:
        _metric("Сообщения пользователей", _value(summary, "messages_user"))
    kpis = st.columns(4)
    with kpis[0]:
        _metric("Создано Trips", _value(summary, "trips_created"))
    with kpis[1]:
        _metric("Создано Proposal", _value(summary, "proposals_created"))
    with kpis[2]:
        _metric("Принято и применено", _value(summary, "proposals_accepted_applied"))
    with kpis[3]:
        _metric("WCAT", _value(summary, "wcat"), "Уникальные Trips с accepted + applied Proposal; полные UTC-недели, пересекающие фильтр")
    users_dates, users_values = _daily_values(dataset, "new_users", start_date, end_date)
    trip_dates, trip_values = _daily_values(dataset, "trips_created", start_date, end_date)
    left, right = st.columns(2)
    with left:
        _chart("Новые пользователи", [("Новые", "#3983c8", users_dates, users_values)])
    with right:
        _chart("Созданные Trips", [("Trips", "#40a88b", trip_dates, trip_values)])
    st.caption("DAU, MAU и retention не показываются: для них нет достоверного источника значимых действий.")

with users_tab:
    st.subheader("Users")
    left, right = st.columns([1.4, 1])
    with left:
        users_dates, users_values = _daily_values(dataset, "new_users", start_date, end_date)
        _chart("Новые аккаунты по дням · UTC", [("Новые пользователи", "#3983c8", users_dates, users_values)])
    with right:
        _metric("Зарегистрировано всего", summary.registered_accounts_ever)
        _metric("Не удалено", summary.registered_accounts_not_deleted)
        _metric("Новых за период", _value(summary, "new_users"))
        st.caption("Snapshot и регистрационные факты; повторные входы не считаются.")
    st.info("DAU / MAU / retention недоступны: текущие данные не содержат достоверной истории значимых действий.")

with discover_tab:
    st.subheader("Discover & Chats")
    match_dates, match_values = _daily_values(dataset, "matches_created", start_date, end_date)
    user_dates, user_values = _daily_values(dataset, "messages_user", start_date, end_date)
    system_dates, system_values = _daily_values(dataset, "messages_system", start_date, end_date)
    left, right = st.columns(2)
    with left:
        _chart("Созданные мэтчи", [("Мэтчи", "#3983c8", match_dates, match_values)])
    with right:
        _chart(
            "Сообщения в чатах",
            [("Пользовательские", "#40a88b", user_dates, user_values), ("Системные", "#9ca8b7", system_dates, system_values)],
            kind="bar",
        )
    st.info("Показываемые данные — мэтчи и сообщения. Просмотры кандидатов и сохранённые Discover-решения отсутствуют в текущем доверенном SQL-источнике.")

with trips_tab:
    st.subheader("Trips & Proposals")
    trip_dates, trip_values = _daily_values(dataset, "trips_created", start_date, end_date)
    proposal_dates, proposal_values = _daily_values(dataset, "proposals_created", start_date, end_date)
    accepted_dates, accepted_values = _daily_values(dataset, "proposals_accepted_applied", start_date, end_date)
    left, right = st.columns(2)
    with left:
        _chart(
            "Создание и согласование",
            [("Trips", "#40a88b", trip_dates, trip_values), ("Proposal", "#3983c8", proposal_dates, proposal_values), ("Принято + применено", "#e8a23b", accepted_dates, accepted_values)],
        )
    with right:
        weekly = sorted(
            (point.period_start, point.value)
            for point in dataset.points
            if point.period_type == "week"
            and point.period_start <= end_date
            and point.period_start + timedelta(days=6) >= start_date
        )
        _chart("WCAT · UTC calendar week", [("Уникальные Trips", "#7657c8", [day for day, _ in weekly], [value for _, value in weekly])])
    st.caption("WCAT — число уникальных Trips с минимум одним accepted + applied Proposal за UTC-неделю. Несколько Proposal на одном Trip считаются один раз.")

st.divider()
st.markdown("**Будущее расширение:** AI usage, costs, Premium, revenue и LTV — не реализованы и не отображаются.")
