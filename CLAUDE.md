# ZGIIS Project Instructions

## Pending feature requirement: Extended Kalman Filter overlay on dashboard graphs

This is a standing requirement for future implementation work on the dashboard (Next.js frontend + FastAPI backend). Treat it as binding spec whenever EKF/dashboard graph work is requested — implement against this exactly unless the user revises it.

### Plotting requirement

The Extended Kalman Filter (EKF) must always be plotted on the already existing graphs on the dashboard.

For every time-series graph already available on the page, add the EKF-predicted series together with the observed/live series. Each graph must continuously show:
- Observed/live values
- Extended Kalman Filter predicted values

The EKF line must always be visible, even when live data is available, so users can compare predicted vs. actual and assess filter performance.

**Graph requirements:**
- Keep the existing graphs and layout.
- Do not create separate graphs unless necessary.
- Add the EKF predicted values to the existing graphs as an additional dataset (not a new chart).
- Solid line for observed values.
- Dashed line for EKF predicted values.
- Legend showing: Observed, EKF Predicted.
- Hover tooltips showing: Timestamp, Observed value, EKF predicted value, Difference/error, Prediction confidence.

### Geomagnetic storm alert requirement

Add an alert rule that checks the gap between the observed value and the EKF predicted value. If the difference becomes unusually large, trigger a warning — this may indicate abnormal ionospheric or geomagnetic conditions.

**Alert logic:**
```
error = abs(observed_value - ekf_predicted_value)
threshold = mean_error + 3 * standard_deviation   # computed from recent historical errors
if error > threshold: trigger alert
```

**Alert message:**
> Possible geomagnetic storm or ionospheric disturbance detected. The observed value has deviated significantly from the Extended Kalman Filter prediction.

**The alert must show:**
- Parameter name
- Observed value
- EKF predicted value
- Difference/error
- Threshold exceeded
- Time of detection
- Suggested risk level

**Risk levels:**
- Low: error is below threshold
- Moderate: error is slightly above threshold
- High: error is far above threshold
- Severe: error is extreme and supported by Kp, Dst, solar wind, or TEC changes

**Cross-checking:** the dashboard must cross-check the alert using related indicators:
- Kp Index
- Dst Index
- Solar wind speed
- Solar flux
- TEC/VTEC
- Scintillation S4
- GNSS risk score

If multiple indicators show abnormal behaviour at the same time, increase the alert severity.

**Alert banner:** show a banner at the top of the dashboard when the EKF deviation alert is triggered, e.g.:
> ⚠ Possible geomagnetic disturbance detected: S4 observed value differs significantly from EKF prediction. Check Kp, Dst, TEC and solar wind conditions.

**Event log:** store each alert with:
- alert_id
- timestamp
- parameter
- observed_value
- ekf_predicted_value
- prediction_error
- threshold
- severity
- related_indicators
- alert_message
- acknowledged_status

### Final outcome

The dashboard must always plot the Extended Kalman Filter predictions on the existing graphs. It must compare observed values with EKF predicted values in real time and generate alerts when the difference becomes unusually large, as this may indicate geomagnetic storm activity or ionospheric disturbance.

Per the project's no-demo-data policy ([[feedback_no_demo_data]]), the EKF prediction itself must be a real computed filter output (driven by genuine observed data), never a synthetic/placeholder series — if the EKF cannot be computed for a given series (insufficient data, filter not yet initialized), omit the predicted line/alert rather than fabricating values.
