/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
  	extend: {
  		fontFamily: {
  			inter: ['var(--font-inter)'],
  			mono: ['var(--font-mono)'],
  		},
  		borderRadius: {
  			lg: 'var(--radius-lg)',
  			md: 'var(--radius-md)',
  			sm: 'var(--radius-sm)',
  			full: 'var(--radius-full)',
  		},
  		boxShadow: {
  			'none': 'none',
  			'xs': 'var(--shadow-xs)',
  			'sm': 'var(--shadow-sm)',
  			DEFAULT: 'var(--shadow-sm)',
  			'md': 'var(--shadow-md)',
  			'lg': 'var(--shadow-lg)',
  			'xl': 'var(--shadow-xl)',
  			'inset': 'var(--shadow-inset)',
  		},
  		colors: {
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			'border-strong': 'hsl(var(--border-strong))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			'status-good': 'hsl(var(--status-good))',
  			'status-good-subtle': 'hsl(var(--status-good-subtle))',
  			'status-warn': 'hsl(var(--status-warn))',
  			'status-warn-subtle': 'hsl(var(--status-warn-subtle))',
  			'status-bad': 'hsl(var(--status-bad))',
  			'status-bad-subtle': 'hsl(var(--status-bad-subtle))',
  			'status-info': 'hsl(var(--status-info))',
  			'status-info-subtle': 'hsl(var(--status-info-subtle))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		keyframes: {
  			'accordion-down': {
  				from: { height: '0' },
  				to: { height: 'var(--radix-accordion-content-height)' }
  			},
  			'accordion-up': {
  				from: { height: 'var(--radix-accordion-content-height)' },
  				to: { height: '0' }
  			},
  			'count-up': {
  				from: { opacity: '0', transform: 'translateY(4px)' },
  				to: { opacity: '1', transform: 'translateY(0)' }
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out',
  			'count-up': 'count-up 400ms ease-out',
  		}
  	}
  },
  safelist: [
    'bg-status-good', 'bg-status-good-subtle', 'text-status-good',
    'bg-status-warn', 'bg-status-warn-subtle', 'text-status-warn',
    'bg-status-bad', 'bg-status-bad-subtle', 'text-status-bad',
    'bg-status-info', 'bg-status-info-subtle', 'text-status-info',
    'border-status-good', 'border-status-warn', 'border-status-bad', 'border-status-info',
  ],
  plugins: [require("tailwindcss-animate")],
}
