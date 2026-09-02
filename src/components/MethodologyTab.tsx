export function MethodologyTab() {
  return (
    <div className="max-w-7xl mx-auto space-y-8 py-2">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-gray-100 mb-1">Valuation Methodology</h2>
        <p className="text-sm text-gray-400 leading-relaxed">
          This page documents the exact calculation steps behind each valuation model in the
          Valuation tab. Both models share the same user-adjustable assumptions and apply an
          identical Margin of Safety framework.
        </p>
      </div>

      {/* ── Shared Assumptions ── */}
      <Section title="Shared Assumptions">
        <p className="text-sm text-gray-400 mb-4 leading-relaxed">
          Both models read the same slider inputs. Defaults are computed automatically from the
          company's historical FCF data when a ticker is loaded; you can override any value with
          the sliders, double-click a value to type a number directly, or right-click to reset to
          the data-driven default.
        </p>
        <DefinitionList items={[
          {
            term: 'Growth Phase (years)',
            def: 'Number of years the company is expected to sustain its elevated growth rate. '
              + 'Auto-set to 6 years when the historical FCF CAGR is below 10%, 5 years when '
              + '10–20%, and 4 years when above 20%.',
          },
          {
            term: 'Growth Phase Rate (Y1 – Yn)',
            def: 'Annual FCFE growth rate applied during the growth phase. '
              + 'Auto-set from the 3-year historical FCF CAGR; falls back to 15% when a valid '
              + 'positive-to-positive CAGR window cannot be found. Range: 0% – 50%.',
          },
          {
            term: 'Steady Phase Rate (Yn+1 – Y10)',
            def: 'Annual FCFE growth rate applied in the remaining years up to Year 10. '
              + 'Auto-set as the average of the growth rate and 3% — i.e. (growthRate + 3%) ÷ 2. '
              + 'Range: 0% – 50%.',
          },
          {
            term: 'Terminal Growth Rate',
            def: 'Perpetual growth rate applied after Year 10 in the Gordon Growth Model. '
              + 'Fixed default of 3% (approximate long-run nominal GDP growth). '
              + 'Must be strictly less than the Discount Rate or the terminal value is set to zero.',
          },
          {
            term: 'Discount Rate (Target IRR)',
            def: 'The required annual rate of return used to discount all future cash flows to '
              + 'present value. Represents the minimum return an investor demands to hold the '
              + 'stock. Range: 5% – 20%.',
          },
          {
            term: 'Uncertainty / Margin of Safety (MOS)',
            def: 'A haircut applied to the calculated intrinsic value to create a buffer for '
              + 'estimation error. Four levels: Low = 5%, Medium = 10%, High = 15%, '
              + 'Very High = 20%. The MOS price is what is used for the undervalued / overvalued '
              + 'verdict against the current market price.',
          },
        ]} />
      </Section>

      {/* ── DCF + FCFY side by side ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">

        {/* ── DCF Model ── */}
        <Section title="DCF Valuation — Step-by-Step">
          <p className="text-sm text-gray-400 mb-4 leading-relaxed">
            A three-phase, 10-year Discounted Cash Flow model applied to Free Cash Flow to
            Equity (FCFE). The intrinsic value per share equals the net present value of all
            projected FCFE plus excess cash, divided by shares outstanding.
          </p>

          <SubSection title="Step 1 — Identify the Starting FCFE (Y0)">
            <Formula>FCFE₀ = Operating Cash Flow (TTM) + Capital Expenditure (TTM) + Net Borrowing (TTM)</Formula>
            <p className="text-sm text-gray-400 mt-2 leading-relaxed">
              FCFE is the cash the business generates that is freely available to equity holders
              after maintaining and growing the asset base and servicing debt. All three components
              are trailing-twelve-month figures sourced from Yahoo Finance's quarterly timeseries
              (sum of the four most recently reported quarters). CapEx is typically negative (cash
              outflow), and Net Borrowing is positive when the company raises new debt and negative
              when it repays debt.
            </p>
          </SubSection>

          <SubSection title="Step 2 — Calculate Excess Cash">
            <Formula>Excess Cash = max(0, Cash &amp; Equivalents − 2% × Revenue)</Formula>
            <p className="text-sm text-gray-400 mt-2 leading-relaxed">
              Not all cash on the balance sheet is "free" — companies hold a working-capital
              reserve (approximated here as 2% of revenue). Any cash above that threshold is
              treated as excess and added directly to intrinsic value, since it could in principle
              be distributed to shareholders today. The 2% ratio is a configurable constant
              (<code className="text-gray-300">excessCashRatio</code>).
            </p>
          </SubSection>

          <SubSection title="Step 3 — Project FCFE for Years 1–10">
            <Formula>
              {'FCFEᵧ = FCFEᵧ₋₁ × (1 + r)'}
              <br />
              {'where r = growthRate  for Y1 … Yn'}
              <br />
              {'      r = steadyRate  for Y(n+1) … Y10'}
            </Formula>
            <p className="text-sm text-gray-400 mt-2 leading-relaxed">
              Each year's FCFE grows at the selected rate from the prior year's value. The model
              allows optional year-by-year CapEx and Net Borrowing overrides for Y1–Y5. When an
              override is set for a given year, the difference between the override value and the
              base-year component is added to the projected FCFE:
            </p>
            <Formula>{'FCFEᵧ (adjusted) = FCFEᵧ + (CapExOverrideᵧ − BaseCapEx) + (NBOverrideᵧ − BaseNB)'}</Formula>
          </SubSection>

          <SubSection title="Step 4 — Calculate Terminal Value">
            <Formula>{'TV = FCFE₁₀ × (1 + terminalGrowth) / (discountRate − terminalGrowth)'}</Formula>
            <p className="text-sm text-gray-400 mt-2 leading-relaxed">
              The Gordon Growth Model values all cash flows beyond Year 10 as a perpetuity growing
              at the terminal rate. If the terminal growth rate equals or exceeds the discount rate,
              the formula is undefined and TV is set to zero. The ratio of the discounted terminal
              value to total NPV is reported as <strong className="text-gray-300">TV / NPV</strong>;
              values above 60% are flagged in amber as a warning that the valuation is highly
              sensitive to terminal assumptions.
            </p>
          </SubSection>

          <SubSection title="Step 5 — Discount to Present Value (NPV)">
            <Formula>
              {'NPV = Σ [FCFEᵧ / (1 + r)ʸ]  for y = 1 … 10'}
              <br />
              {'    + TV / (1 + r)¹⁰'}
              <br />
              {'    + Excess Cash'}
            </Formula>
            <p className="text-sm text-gray-400 mt-2 leading-relaxed">
              Each year's projected FCFE is discounted back to today using the selected discount
              rate. The discounted terminal value and excess cash are added. The result is the
              total present value of the business attributable to equity holders.
            </p>
          </SubSection>

          <SubSection title="Closed-Form Equivalent — the three additive terms">
            <p className="text-sm text-gray-400 mb-2 leading-relaxed">
              Steps 1–5 are geometric series, so the FCFE portion of the value has an exact
              closed form: three additive present-value terms, per unit of forward FCFE₁
              (= FCFE₀ × (1 + g)). With n₁ growth years at g, n₂ = 10 − n₁ steady years at m,
              terminal t and discount r:
            </p>
            <Formula>
              {'Phase 1  = [ 1 − ((1+g)/(1+r))^n₁ ] / (r − g)'}
              <br />
              {'Phase 2  = (1+g)^(n₁−1)/(1+r)^n₁ · (1+m)/(r−m) · [ 1 − ((1+m)/(1+r))^n₂ ]'}
              <br />
              {'Terminal = (1+g)^(n₁−1) (1+m)^n₂ (1+t) / [ (r − t)(1+r)^(n₁+n₂) ]'}
            </Formula>
            <p className="text-sm text-gray-400 mt-2 leading-relaxed">
              These sum to the same NPV as the year-by-year discounting above (verified in the
              test-suite). The model runs the discrete version at runtime because it also carries
              the per-year CapEx / Net-Borrowing overrides and excess cash, which the closed form
              can't express. The DCF Analysis card reports each term as a share of intrinsic value —
              a high <strong className="text-gray-300">Terminal</strong> share means most of the
              value rests on year-11-and-beyond assumptions. n₁ is the growth-phase length, which
              adapts to the growth rate (6 years below 10%, 5 at 10–20%, 4 above 20%).
            </p>
          </SubSection>

          <SubSection title="Step 6 — Convert to Intrinsic Value Per Share">
            <Formula>
              {'Intrinsic Value = NPV / Shares Outstanding'}
              <br />
              {'MOS Price       = Intrinsic Value × (1 − MOS%)'}
            </Formula>
            <p className="text-sm text-gray-400 mt-2 leading-relaxed">
              Dividing NPV by the diluted share count gives a per-share intrinsic value. Applying
              the Margin of Safety discount gives the MOS Price — the maximum price at which a
              rational investor with the chosen uncertainty tolerance should buy the stock. If the
              current market price is below the MOS Price, the model signals{' '}
              <span className="text-green-400 font-medium">UNDERVALUED</span>; otherwise{' '}
              <span className="text-red-400 font-medium">OVERVALUED</span>.
            </p>
          </SubSection>

          <SubSection title="Default Assumption Derivation">
            <p className="text-sm text-gray-400 mb-2 leading-relaxed">
              When a ticker is loaded, the app automatically computes default slider values from
              historical FCF data:
            </p>
            <DefinitionList items={[
              {
                term: 'growthRate (default)',
                def: '3-year FCF CAGR: (latestFCF / FCF₃ᵧₐᵣₛₐ𝓰ₒ)^(1/3) − 1. '
                  + 'Falls back to 15% if a valid positive-to-positive window is not found.',
              },
              {
                term: 'growthYears (default)',
                def: '6 years if growthRate < 10%; 5 years if 10%–20%; 4 years if > 20%.',
              },
              {
                term: 'steadyRate (default)',
                def: '(growthRate + 3%) ÷ 2 — a midpoint between the growth phase and long-run GDP.',
              },
              {
                term: 'terminalGrowth (default)',
                def: '3% — fixed regardless of company characteristics.',
              },
            ]} />
          </SubSection>
        </Section>

        {/* ── FCFY Model ── */}
        <Section title="Forward FCF Yield (FCFY) Valuation — Step-by-Step">
          <p className="text-sm text-gray-400 mb-4 leading-relaxed">
            The Forward FCF Yield model asks a different question than the DCF:{' '}
            <em className="text-gray-300">"What is the minimum FCF yield the stock must offer
            today in order to deliver the target IRR, given the projected growth path?"</em>{' '}
            It is a quick, intuitive cross-check on the DCF that does not require a full
            10-year projection.
          </p>

          <SubSection title="Step 1 — Compute Blended Growth Rate">
            <Formula>{'Blended Growth = (growthYears × growthRate + (10 − growthYears) × steadyRate) / 10'}</Formula>
            <p className="text-sm text-gray-400 mt-2 leading-relaxed">
              The blended rate is the weighted-average annual growth over the full 10-year horizon,
              combining the growth-phase rate and the steady-phase rate. It summarises the entire
              assumed growth trajectory into a single number.
            </p>
          </SubSection>

          <SubSection title="Step 2 — Compute Required Minimum FCF Yield">
            <p className="text-sm text-gray-400 mb-2 leading-relaxed">
              A piecewise linear function maps the blended growth rate <em>g</em> and the discount
              rate <em>R</em> to the minimum FCF yield an investor should demand today:
            </p>
            <Formula>
              {'g ≤ 8%:          minYield = (R + 0.03) − 0.40 × g'}
              <br />
              {'8% < g ≤ 15%:   minYield = (R + 0.01) − 0.29 × g'}
              <br />
              {'g > 15%:         minYield = (R + 0.03) − 0.33 × g'}
            </Formula>
            <p className="text-sm text-gray-400 mt-2 leading-relaxed">
              The three bands reflect the diminishing yield premium needed as growth increases:
              high-growth companies justify lower current yields because a larger share of returns
              comes from future capital appreciation rather than today's cash generation. Note that
              the intercepts sit <em>above</em> the discount rate (R + 1% to R + 3%), which makes
              this a deliberately conservative hurdle rather than a DCF-equivalent — in practice it
              lands 1.5–2.6× below the DCF price. See{' '}
              <strong className="text-gray-300">DCF vs Forward FCF Yield</strong> below.
            </p>
          </SubSection>

          <SubSection title="Step 3 — Project Year 1 FCFE">
            <Formula>{'FCFE_Y1 = FCFE₀ × (1 + growthRate)'}</Formula>
            <p className="text-sm text-gray-400 mt-2 leading-relaxed">
              The model uses only a single forward year of FCFE — the current FCFE grown by the
              growth-phase rate for one period. This keeps the model simple and avoids compounding
              estimation error over multiple years.
            </p>
          </SubSection>

          <SubSection title="Step 4 — Compute FCFY Intrinsic Value Per Share">
            <Formula>
              {'FCFY Price = FCFE_Y1 / minYield / Shares Outstanding'}
              <br />
              {'MOS Price  = FCFY Price × (1 − MOS%)'}
            </Formula>
            <p className="text-sm text-gray-400 mt-2 leading-relaxed">
              Dividing Y1 FCFE by the required yield gives the maximum total equity value at which
              an investor achieves the target IRR. Dividing by shares converts this to a per-share
              price. The Margin of Safety haircut is then applied identically to the DCF model.
            </p>
          </SubSection>
        </Section>

      </div>

      {/* ── Why the two valuation numbers differ ── */}
      <Section title="DCF vs Forward FCF Yield — why the two numbers differ">
        <p className="text-sm text-gray-400 mb-4 leading-relaxed">
          Both models value the <strong className="text-gray-300">same cash flow</strong> (FCFE) —
          they are not measuring different things. The entire difference is method: the DCF projects
          ten years and discounts them plus a terminal value; the FCFY skips projection and
          capitalises a single forward year at one required yield.
        </p>

        <SubSection title="Both reduce to FCFE₁ ÷ a required yield">
          <Formula>
            {'DCF :  yield = 1 / (Phase1 + Phase2 + Terminal)     ← derived from the projection'}
            <br />
            {'FCFY:  yield = R + c − k × blendedGrowth            ← asserted by a fitted formula'}
          </Formula>
          <p className="text-sm text-gray-400 mt-2 leading-relaxed">
            This is the crux. In the DCF the required yield is an <em>emergent result</em> of ten
            years of compounding plus the Gordon tail. In the FCFY it is simply stated by a
            piecewise-linear rule whose constants are not derived from the DCF's own parameters.
          </p>
        </SubSection>

        <SubSection title="Which assumptions each model actually consumes">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-gray-500">
                  <th className="text-left font-medium py-1.5 pr-4 border-b border-gray-800">Input</th>
                  <th className="text-left font-medium py-1.5 pr-4 border-b border-gray-800">DCF</th>
                  <th className="text-left font-medium py-1.5 border-b border-gray-800">FCFY</th>
                </tr>
              </thead>
              <tbody className="text-gray-400">
                {[
                  ['growthRate (g)', 'Compounds geometrically for n₁ years', 'Linear, via the blended average'],
                  ['steadyRate (m)', 'Compounds for n₂ years', 'Linear, via the blended average'],
                  ['growthYears (n₁)', 'Sets the compounding horizon', 'Sets blend weights only'],
                  ['terminalGrowth (t)', '1/(R−t) — drives 40–55% of value', 'Not used at all'],
                  ['discountRate (R)', 'Discounts every year and the terminal', 'Linear intercept'],
                  ['Excess cash', 'Added to NPV', 'Not used'],
                  ['Margin of Safety', 'Applied', 'Applied — cancels, never the cause'],
                ].map(([k, d, f]) => (
                  <tr key={k} className="align-top">
                    <td className="py-1.5 pr-4 border-b border-gray-800/60 font-mono text-[12px] text-gray-300 whitespace-nowrap">{k}</td>
                    <td className="py-1.5 pr-4 border-b border-gray-800/60 text-[13px]">{d}</td>
                    <td className={`py-1.5 border-b border-gray-800/60 text-[13px] ${f === 'Not used at all' ? 'text-amber-300' : ''}`}>{f}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-gray-400 mt-2 leading-relaxed">
            The decisive row is <strong className="text-gray-300">terminalGrowth</strong>. It is the
            DCF's most powerful lever and the FCFY formula contains no terminal-growth term at all.
          </p>
        </SubSection>

        <SubSection title="Sensitivity — how each model responds">
          <p className="text-sm text-gray-400 mb-3 leading-relaxed">
            Values below are per $1 of trailing FCFE (i.e. the multiple each model pays), base case
            g = 12%, m = 7.5%, t = 3%, R = 11%, one variable moved at a time.
          </p>

          <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">
            A · Terminal growth — FCFY is a flat line
          </div>
          <div className="overflow-x-auto mb-4">
            <table className="text-sm border-collapse font-mono">
              <thead>
                <tr className="text-[11px] text-gray-500">
                  <th className="text-right font-medium py-1 pr-6">t</th>
                  <th className="text-right font-medium py-1 pr-6">DCF</th>
                  <th className="text-right font-medium py-1 pr-6">FCFY</th>
                  <th className="text-right font-medium py-1">DCF/FCFY</th>
                </tr>
              </thead>
              <tbody className="text-gray-400">
                {[['0%', '17.99', '12.21', '1.47×'], ['2%', '19.99', '12.21', '1.64×'],
                  ['3%', '21.36', '12.21', '1.75×'], ['5%', '25.49', '12.21', '2.09×']].map((r) => (
                  <tr key={r[0]}>
                    <td className="text-right py-1 pr-6 text-gray-300">{r[0]}</td>
                    <td className="text-right py-1 pr-6">{r[1]}</td>
                    <td className="text-right py-1 pr-6 text-amber-300">{r[2]}</td>
                    <td className="text-right py-1">{r[3]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-gray-400 mb-4 leading-relaxed">
            Across that range the DCF gains <strong className="text-gray-300">+42%</strong> while the
            FCFY does not move at all.
          </p>

          <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">
            B · Growth rate — compounding beats a linear discount
          </div>
          <div className="overflow-x-auto mb-4">
            <table className="text-sm border-collapse font-mono">
              <thead>
                <tr className="text-[11px] text-gray-500">
                  <th className="text-right font-medium py-1 pr-6">g</th>
                  <th className="text-right font-medium py-1 pr-6">DCF</th>
                  <th className="text-right font-medium py-1 pr-6">FCFY</th>
                  <th className="text-right font-medium py-1">DCF/FCFY</th>
                </tr>
              </thead>
              <tbody className="text-gray-400">
                {[['4%', '13.67', '8.33', '1.64×'], ['12%', '21.36', '12.21', '1.75×'],
                  ['16%', '26.69', '13.97', '1.91×'], ['20%', '33.28', '13.63', '2.44×'],
                  ['25%', '40.33', '15.77', '2.56×']].map((r) => (
                  <tr key={r[0]}>
                    <td className="text-right py-1 pr-6 text-gray-300">{r[0]}</td>
                    <td className="text-right py-1 pr-6">{r[1]}</td>
                    <td className="text-right py-1 pr-6">{r[2]}</td>
                    <td className="text-right py-1">{r[3]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-gray-400 mb-4 leading-relaxed">
            DCF rises +195% across the range versus +89% for FCFY. Note the FCFY value{' '}
            <em>falls</em> from 13.97 to 13.63 as growth rises from 16% to 20% — a discontinuity
            where the blended rate crosses the 15% band boundary.
          </p>

          <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">
            C · Discount rate — the one input both treat alike
          </div>
          <div className="overflow-x-auto mb-2">
            <table className="text-sm border-collapse font-mono">
              <thead>
                <tr className="text-[11px] text-gray-500">
                  <th className="text-right font-medium py-1 pr-6">R</th>
                  <th className="text-right font-medium py-1 pr-6">DCF</th>
                  <th className="text-right font-medium py-1 pr-6">FCFY</th>
                  <th className="text-right font-medium py-1">DCF/FCFY</th>
                </tr>
              </thead>
              <tbody className="text-gray-400">
                {[['8%', '35.64', '18.14', '1.96×'], ['10%', '24.74', '13.70', '1.81×'],
                  ['11%', '21.36', '12.21', '1.75×'], ['13%', '16.67', '10.02', '1.66×']].map((r) => (
                  <tr key={r[0]}>
                    <td className="text-right py-1 pr-6 text-gray-300">{r[0]}</td>
                    <td className="text-right py-1 pr-6">{r[1]}</td>
                    <td className="text-right py-1 pr-6">{r[2]}</td>
                    <td className="text-right py-1">{r[3]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-gray-400 leading-relaxed">
            Both fall as R rises and the ratio stays in a tight 1.66–1.96× band. Excess cash adds a
            further wedge: at the base case it lifts the DCF ~13% while the FCFY ignores it entirely.
          </p>
        </SubSection>

        <SubSection title="How to read the two numbers">
          <p className="text-sm text-gray-400 leading-relaxed">
            The gap is <strong className="text-gray-300">structural, one-directional and roughly
            constant</strong> (1.5–2.6×), so "the two models agree" is not a signal — the bias is
            baked in rather than informative. Treat the{' '}
            <strong className="text-gray-300">DCF as the valuation</strong> and the FCFY's minimum
            yield as a <strong className="text-gray-300">hurdle rate or screening filter</strong>. The
            FCFY answers a deliberately different question: <em>"what would I pay if I refused to
            underwrite any terminal value at all?"</em> — which is why it is always the more
            conservative figure.
          </p>
        </SubSection>
      </Section>

      {/* ── Metric Definitions ── */}
      <Section title="Metric Definitions">
        <p className="text-sm text-gray-400 mb-4 leading-relaxed">
          All financial inputs are sourced from SEC EDGAR XBRL filings for US-listed companies,
          supplemented by Yahoo Finance for balance-sheet and cash-flow figures. When EDGAR
          data is unavailable (foreign filers, recent IPOs), Yahoo Finance is used as the
          primary source. All monetary figures are reported in the company's functional currency.
        </p>
        <DefinitionList items={[
          {
            term: 'FCFE — Free Cash Flow to Equity',
            def: 'Operating Cash Flow + Capital Expenditure + Net Borrowing. '
              + 'Represents cash available to equity holders after maintaining the asset base '
              + 'and accounting for net debt movements. CapEx is a cash outflow (negative) and '
              + 'Net Borrowing is positive for new issuance, negative for repayments. '
              + 'Sourced as TTM (sum of four most recent quarters).',
          },
          {
            term: 'Operating Cash Flow (CFO)',
            def: 'Cash generated from the company\'s core business operations, before investing '
              + 'or financing activities. Corresponds to XBRL tag '
              + 'NetCashProvidedByUsedInOperatingActivities (US-GAAP) or '
              + 'CashFlowsFromUsedInOperatingActivities (IFRS). TTM figure used.',
          },
          {
            term: 'Capital Expenditure (CapEx)',
            def: 'Cash spent on acquiring or maintaining property, plant and equipment. '
              + 'Reported as a negative number (outflow) throughout the models. '
              + 'Sourced from PaymentsToAcquirePropertyPlantAndEquipment or equivalent tags. '
              + 'TTM figure used.',
          },
          {
            term: 'Net Borrowing',
            def: 'Net proceeds from issuing new debt minus repayments of existing debt. '
              + 'A positive value increases FCFE (company raised cash); a negative value '
              + 'reduces FCFE (company repaid debt). Sourced from '
              + 'annualNetIssuancePaymentsOfDebt via Yahoo Finance.',
          },
          {
            term: 'Revenue',
            def: 'Total net revenue for the trailing twelve months (sum of four most recent '
              + 'quarters). Used only to calculate the working-capital cash reserve '
              + '(2% of revenue) that is subtracted from cash before computing excess cash. '
              + 'Sourced from RevenueFromContractWithCustomerExcludingAssessedTax or '
              + 'equivalent XBRL tags.',
          },
          {
            term: 'Cash & Equivalents',
            def: 'Cash, cash equivalents and short-term investments as reported on the most '
              + 'recent balance sheet. Sourced from '
              + 'CashCashEquivalentsAndShortTermInvestments (EDGAR) or the Yahoo Finance '
              + 'annual balance sheet. The most recent point-in-time figure is used.',
          },
          {
            term: 'Excess Cash',
            def: 'The portion of cash held above the working-capital reserve (2% of revenue). '
              + 'Added directly to NPV since it is not needed to run the business and could '
              + 'theoretically be distributed. Formula: max(0, Cash − 2% × Revenue).',
          },
          {
            term: 'Shares Outstanding',
            def: 'Diluted share count used as the divisor when converting NPV to a per-share '
              + 'intrinsic value. Sourced from CommonStockSharesIssued (EDGAR), '
              + 'EntityCommonStockSharesOutstanding (DEI taxonomy), or '
              + 'the Yahoo Finance balance sheet — whichever has the most recent data.',
          },
          {
            term: 'Net Present Value (NPV)',
            def: 'The sum of all discounted future FCFE projections, plus the discounted '
              + 'terminal value, plus excess cash. Represents the total present-day '
              + 'value of the business attributable to equity holders.',
          },
          {
            term: 'Terminal Value (TV)',
            def: 'The value of all cash flows beyond Year 10, modelled as a Gordon Growth '
              + 'perpetuity: TV = FCFE₁₀ × (1 + g) / (r − g). '
              + 'Sensitive to the spread between the discount rate and terminal growth rate; '
              + 'small changes in either assumption can move TV significantly.',
          },
          {
            term: 'TV / NPV Ratio',
            def: 'The fraction of total NPV attributable to the terminal value. '
              + 'Values above 60% (flagged in amber) indicate that the majority of the '
              + 'modelled value is beyond the 10-year explicit forecast window, making the '
              + 'valuation highly sensitive to terminal assumptions.',
          },
          {
            term: 'Discount Rate (r)',
            def: 'The hurdle rate used to discount projected cash flows. Conceptually equal '
              + 'to the investor\'s required rate of return (target IRR). Higher discount '
              + 'rates produce lower intrinsic values; lower rates produce higher values.',
          },
          {
            term: 'Margin of Safety (MOS)',
            def: 'A percentage haircut applied to the calculated intrinsic value to compensate '
              + 'for model uncertainty and estimation error. Low = 5%, Medium = 10%, '
              + 'High = 15%, Very High = 20%. A stock is considered undervalued only when '
              + 'its market price is below the MOS-adjusted price.',
          },
          {
            term: 'Blended Growth Rate',
            def: 'FCFY-model only. The weighted-average annual growth rate across the full '
              + '10-year horizon: (growthYears × growthRate + (10 − growthYears) × steadyRate) / 10. '
              + 'Determines which piecewise band of the required-yield formula is applied.',
          },
          {
            term: 'Required Minimum FCF Yield (minYield)',
            def: 'FCFY-model only. The minimum trailing FCF yield the stock must offer today '
              + 'for an investor to achieve the target IRR given the projected growth path. '
              + 'Derived from the piecewise formula calibrated to the blended growth rate '
              + 'and discount rate.',
          },
          {
            term: 'Intrinsic Value',
            def: 'The per-share present value of all future cash flows, calculated by either '
              + 'model. Represents a fair-value estimate under the specified assumptions — '
              + 'not a guarantee of future price. Both the DCF Intrinsic Value and the FCFY '
              + 'Price are shown before and after applying the Margin of Safety.',
          },
        ]} />
      </Section>

      {/* ── Data Sources ── */}
      <Section title="Data Sources & Limitations">
        <DefinitionList items={[
          {
            term: 'SEC EDGAR XBRL',
            def: 'Primary source for all periodic financials (quarterly and annual). '
              + 'Data is pulled from the companyfacts API using the company\'s CIK. '
              + 'Covers US-GAAP and IFRS filers. Updated after each filing.',
          },
          {
            term: 'Yahoo Finance',
            def: 'Supplementary source for TTM flow metrics (quarterly timeseries), '
              + 'balance-sheet snapshots, analyst estimates, price history, and share counts. '
              + 'Used as the primary source when EDGAR data is unavailable or sparse.',
          },
          {
            term: 'TTM vs Annual',
            def: 'The valuation models use trailing-twelve-month (TTM) figures computed by '
              + 'summing the four most recently reported quarters. This avoids understating '
              + 'the current run-rate for companies mid-way through a fiscal year '
              + '(e.g. a June fiscal year-end company in October).',
          },
          {
            term: 'Limitations',
            def: 'Model outputs are estimates based on user-set assumptions and historical data. '
              + 'They are not investment advice. FCFE-based models are best suited to '
              + 'cash-generative, mature businesses; they can be misleading for pre-profit '
              + 'companies, financial firms, or businesses with highly volatile cash flows. '
              + 'Always apply independent judgement.',
          },
        ]} />
      </Section>

      <div className="text-center text-[10px] text-gray-700 pb-4">
        EquityVal · SEC EDGAR XBRL · Yahoo Finance · Not investment advice
      </div>
    </div>
  );
}

/* ── Internal layout components ── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-base font-bold text-gray-100 border-b border-gray-800 pb-2 mb-4">
        {title}
      </h3>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-blue-400 mb-2">{title}</h4>
      <div className="pl-3 border-l border-gray-800">{children}</div>
    </div>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <pre className="bg-gray-950 border border-gray-800 rounded-lg px-4 py-3 text-[12px] font-mono text-gray-200 whitespace-pre-wrap leading-relaxed overflow-x-auto">
      {children}
    </pre>
  );
}

function DefinitionList({ items }: { items: { term: string; def: string }[] }) {
  return (
    <dl className="space-y-3">
      {items.map(({ term, def }) => (
        <div key={term} className="grid grid-cols-1 gap-0.5 sm:grid-cols-[220px_1fr] sm:gap-4">
          <dt className="text-sm font-semibold text-gray-200 pt-0.5">{term}</dt>
          <dd className="text-sm text-gray-400 leading-relaxed">{def}</dd>
        </div>
      ))}
    </dl>
  );
}
