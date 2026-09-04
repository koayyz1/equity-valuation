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

          <SubSection title="Step 2 — Derive the Required Yield from the DCF">
            <p className="text-sm text-gray-400 mb-2 leading-relaxed">
              The required yield is not fitted — it is the DCF's own implied forward yield, obtained
              by inverting the three-term closed form (per unit of forward FCFE₁):
            </p>
            <Formula>
              {'F = FCFE₁ / (S₁ + S₂ + S_T)'}
              <br />
              {'   S₁ = growth-phase PV,  S₂ = steady-phase PV,  S_T = terminal PV'}
            </Formula>
            <p className="text-sm text-gray-400 mt-2 leading-relaxed">
              At this point F is <em>exactly</em> DCF-equivalent: capitalising FCFE₁ at F reproduces
              the DCF price (excluding excess cash). The two models therefore cannot silently
              disagree.
            </p>
          </SubSection>

          <SubSection title="Step 2b — Apply the Terminal Haircut (conservatism lever)">
            <Formula>
              {'requiredYield = FCFE₁ / ( S₁ + S₂ + S_T × (1 − haircut) )'}
            </Formula>
            <p className="text-sm text-gray-400 mt-2 leading-relaxed">
              Because F alone would just restate the DCF, the model discards a stated fraction of the
              terminal term — the least reliable piece, typically 40–55% of total value. This is what
              makes FCFY a genuinely stricter hurdle rather than a duplicate, and the conservatism is
              an explicit, tunable assumption instead of hardcoded constants. A haircut of{' '}
              <strong className="text-gray-300">0</strong> gives the DCF answer;{' '}
              <strong className="text-gray-300">1</strong> credits no terminal value at all, answering
              "what would I pay for the next ten years alone?" The default is 50%.
            </p>
            <p className="text-sm text-gray-400 mt-2 leading-relaxed">
              This replaces an earlier piecewise-linear fit (three growth bands with intercepts of
              R + 1% to R + 3%). Measured against the DCF that fit ran 1.5–2.6× low and was
              discontinuous at the band boundaries — at one boundary the implied price
              <em> fell</em> as growth rose. See{' '}
              <strong className="text-gray-300">DCF vs Forward FCF Yield</strong> below for the
              comparison that motivated the change.
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

          <SubSection title="Step 4 — Compare Offered Yield vs Required Yield">
            <Formula>
              {'actualYield = FCFE_Y1 / Market Cap'}
              <br />
              {'yield gap   = actualYield − requiredYield      (clears hurdle when ≥ 0)'}
              <br />
              {'FCFY Price  = FCFE_Y1 / requiredYield / Shares'}
            </Formula>
            <p className="text-sm text-gray-400 mt-2 leading-relaxed">
              The panel leads with the yield comparison rather than a rival price: what the stock
              actually offers today versus what these assumptions demand. This is the question the
              model's name promises, and it avoids presenting a second "fair value" that would
              otherwise just be the DCF restated. The implied price and the Margin of Safety haircut
              are still shown for reference, applied identically to the DCF model.
            </p>
          </SubSection>
        </Section>

      </div>

      {/* ── How the two valuation numbers relate ── */}
      <Section title="DCF vs Forward FCF Yield — how the two numbers relate">
        <p className="text-sm text-gray-400 mb-4 leading-relaxed">
          Both models value the <strong className="text-gray-300">same cash flow</strong> (FCFE) and,
          since the FCFY was rebuilt, they share the <strong className="text-gray-300">same
          maths</strong>. The FCFY no longer asserts a fitted yield — it inverts the DCF's own
          closed form. Everything that separates the two numbers is now one explicit assumption:
          the terminal haircut.
        </p>

        <SubSection title="The required yield is derived, not fitted">
          <Formula>
            {'F        = FCFE₁ / (S₁ + S₂ + S_T)              ← exactly DCF-equivalent'}
            <br />
            {'required = FCFE₁ / (S₁ + S₂ + S_T × (1 − h))    ← h = terminal haircut'}
          </Formula>
          <p className="text-sm text-gray-400 mt-2 leading-relaxed">
            At <strong className="text-gray-300">h = 0</strong> the FCFY price equals the DCF price
            exactly (excluding excess cash) — a property asserted in the test-suite, so the two can
            no longer drift apart unnoticed. Raising h discards a stated fraction of the terminal
            term, turning the FCFY into a deliberately stricter hurdle rather than a rival estimate.
          </p>
        </SubSection>

        <SubSection title="The gap between them is fully determined">
          <Formula>{'FCFY price / DCF price = 1 − h × (terminal share of value)'}</Formula>
          <p className="text-sm text-gray-400 mt-2 leading-relaxed">
            There is no residual mystery in the difference: it is the haircut multiplied by how much
            of the company's value sits in the terminal term. A business whose value is mostly
            near-term cash is barely affected; one that rests on the perpetuity is discounted hard.
          </p>
          <div className="overflow-x-auto mt-3">
            <table className="text-sm border-collapse font-mono">
              <thead>
                <tr className="text-[11px] text-gray-500">
                  <th className="text-right font-medium py-1 pr-6">growth</th>
                  <th className="text-right font-medium py-1 pr-6">terminal share</th>
                  <th className="text-right font-medium py-1 pr-6">h = 0.25</th>
                  <th className="text-right font-medium py-1 pr-6">h = 0.50</th>
                  <th className="text-right font-medium py-1">h = 1.00</th>
                </tr>
              </thead>
              <tbody className="text-gray-400">
                {[
                  ['4%', '48.2%', '0.88×', '0.76×', '0.52×'],
                  ['12%', '53.7%', '0.87×', '0.73×', '0.46×'],
                  ['25%', '60.2%', '0.85×', '0.70×', '0.40×'],
                ].map((r) => (
                  <tr key={r[0]}>
                    <td className="text-right py-1 pr-6 text-gray-300">{r[0]}</td>
                    <td className="text-right py-1 pr-6">{r[1]}</td>
                    <td className="text-right py-1 pr-6">{r[2]}</td>
                    <td className="text-right py-1 pr-6">{r[3]}</td>
                    <td className="text-right py-1">{r[4]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-gray-400 mt-2 leading-relaxed">
            Faster-growing companies carry more of their value in the terminal term, so the same
            haircut bites harder — which is the intended behaviour: the further out the value sits,
            the less certain it is.
          </p>
        </SubSection>

        <SubSection title="What each surfaces">
          <p className="text-sm text-gray-400 leading-relaxed">
            The DCF answers <em>"what is this worth?"</em> and is the valuation. The FCFY answers{' '}
            <em>"does today's cash yield clear the bar these assumptions imply, if I only
            part-credit the perpetuity?"</em> and is a hurdle. Because the second is now derived
            from the first, agreement between them is guaranteed rather than informative — the
            useful reading is the <strong className="text-gray-300">yield gap</strong> (offered
            minus required) and the <strong className="text-gray-300">terminal share</strong>, both
            shown on their respective cards.
          </p>
        </SubSection>

        <SubSection title="Note on the previous approach">
          <p className="text-sm text-gray-400 leading-relaxed">
            Until recently the FCFY set its yield from a piecewise-linear fit in three growth bands,
            with intercepts of R + 1% to R + 3%. Because those constants were not tied to the DCF's
            terminal growth, the two models disagreed by 1.5–2.6× with no stated reason, the fit was
            discontinuous at the band boundaries (at one, the implied price <em>fell</em> as growth
            rose), and extrapolating it far enough produced a negative required yield and a negative
            fair value. The derivation above removes all four failure modes by construction.
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
            def: 'The weighted-average annual growth rate across the full 10-year horizon: '
              + '(growthYears × growthRate + (10 − growthYears) × steadyRate) / 10. Reported as a '
              + 'summary of the assumed growth path; it no longer drives the required yield.',
          },
          {
            term: 'Required Yield',
            def: 'FCFY-model only. The forward FCFE yield the stock must offer today to clear the '
              + 'hurdle: FCFE₁ / (S₁ + S₂ + S_T × (1 − terminal haircut)). With a zero haircut this '
              + 'is the DCF’s own implied yield, so the two models agree exactly.',
          },
          {
            term: 'Terminal Haircut',
            def: 'FCFY-model only. The fraction of the DCF’s terminal value discarded when '
              + 'setting the required yield — the model’s conservatism lever. 0 reproduces the '
              + 'DCF; 1 credits no terminal value at all. Default 50%.',
          },
          {
            term: 'Yield Gap',
            def: 'Actual forward FCFE yield (FCFE₁ / market cap) minus the required yield. '
              + 'Positive means the stock clears the hurdle. This single comparison drives the '
              + 'verdict everywhere it appears, including the watchlist.',
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
